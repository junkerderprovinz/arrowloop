package arrowloop.halleluja.design

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.LocalServerSocket
import android.net.LocalSocket
import android.net.Uri
import android.os.Process
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/**
 * Folders other apps share through Android's file picker, such as the files a
 * keyboard keeps in its own storage. Only this app can open them, through the
 * Storage Access Framework, so it answers for them on a socket the engine
 * puts behind the Apps target (see internal/appdocs for the protocol). The
 * socket takes connections from this app's own processes alone.
 *
 * SAF cannot set a modification time, and the sync compares size and time.
 * The time the engine asks for is kept here and reported for as long as the
 * file's own size and time are still the ones it had then.
 */
object Docs {

    /** A shared folder: its name in the target, the grant, and the app that shares it. */
    class Folder(val name: String, val uri: Uri, val app: String)

    private const val TAG = "ArrowLoop"
    private const val TIMES = "docTimes"
    private const val CHUNK = 64 * 1024

    private val COLUMNS = arrayOf(
        Document.COLUMN_DOCUMENT_ID,
        Document.COLUMN_DISPLAY_NAME,
        Document.COLUMN_MIME_TYPE,
        Document.COLUMN_SIZE,
        Document.COLUMN_LAST_MODIFIED,
        Document.COLUMN_FLAGS,
    )

    @Volatile
    private var server: LocalServerSocket? = null

    /** The folders granted so far, in the order they were added, named apart. */
    fun folders(context: Context): List<Folder> {
        val taken = HashSet<String>()
        return context.contentResolver.persistedUriPermissions
            .filter { it.isReadPermission && DocumentsContract.isTreeUri(it.uri) }
            .sortedBy { it.persistedTime }
            .map { grant ->
                val base = folderName(context, grant.uri)
                var name = base
                var n = 2
                while (!taken.add(name)) name = "$base ${n++}"
                Folder(name, grant.uri, appLabel(context, grant.uri))
            }
    }

    private fun folderName(context: Context, tree: Uri): String {
        val root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        val name = try {
            context.contentResolver.query(root, arrayOf(Document.COLUMN_DISPLAY_NAME), null, null, null)
                ?.use { if (it.moveToFirst()) it.getString(0) else null }
        } catch (e: Exception) {
            null
        }
        return (name ?: DocumentsContract.getTreeDocumentId(tree)).replace('/', '_').ifBlank { "folder" }
    }

    private fun appLabel(context: Context, tree: Uri): String {
        val pm = context.packageManager
        val provider = tree.authority?.let { pm.resolveContentProvider(it, 0) } ?: return tree.authority ?: ""
        return provider.applicationInfo.loadLabel(pm).toString()
    }

    /** Keeps the folder the file picker returned, for reading and, where allowed, writing. */
    fun add(context: Context, result: Intent) {
        val uri = result.data ?: return
        val flags = result.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        context.contentResolver.takePersistableUriPermission(uri, flags)
        Engine.restart(context)
    }

    fun remove(context: Context, uri: Uri) {
        val all = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        try {
            context.contentResolver.releasePersistableUriPermission(uri, all)
        } catch (e: SecurityException) {
            // Already gone, which is what was asked for.
        }
        Engine.restart(context)
    }

    /** The variable that makes the engine offer the Apps target; empty without folders. */
    @Synchronized
    fun environment(context: Context): Map<String, String> {
        if (folders(context).isEmpty()) return emptyMap()
        val name = "${context.packageName}.docs"
        if (server == null) {
            server = try {
                listen(context.applicationContext, name)
            } catch (e: IOException) {
                Log.w(TAG, "shared folders: cannot listen on $name: ${e.message}")
                return emptyMap()
            }
        }
        // Go reads a leading @ as Linux's abstract namespace, where Android's
        // local sockets live.
        return mapOf("ARROWLOOP_DOCS_SOCKET" to "@$name")
    }

    private fun listen(context: Context, name: String): LocalServerSocket {
        val socket = LocalServerSocket(name)
        Thread {
            while (true) {
                val conn = try {
                    socket.accept()
                } catch (e: IOException) {
                    Log.w(TAG, "shared folders: ${e.message}")
                    break
                }
                Thread { conn.use { answer(context, it) } }.apply { isDaemon = true }.start()
            }
        }.apply { isDaemon = true }.start()
        return socket
    }

    /** A request that cannot be done, with the code internal/appdocs reads. */
    private class Refusal(val code: String?, message: String) : Exception(message)

    private fun missing(what: String) = Refusal("missing", "$what is not there")

    private fun denied(what: String) = Refusal("denied", what)

    private fun answer(context: Context, conn: LocalSocket) {
        // Every app on the phone can reach the abstract namespace.
        if (conn.peerCredentials.uid != Process.myUid()) return
        val input = DataInputStream(BufferedInputStream(conn.inputStream))
        val output = BufferedOutputStream(conn.outputStream)
        val request = JSONObject(readLine(input))
        val op = request.getString("op")
        val reply = JSONObject()
        var body: InputStream? = null
        try {
            val session = Session(context, folders(context))
            when (op) {
                "stat" -> reply.put("entry", session.stat(request.getString("path")))
                "list" -> reply.put("entries", session.list(request.getString("path")))
                "read" -> body = session.read(request.getString("path"))
                "write" -> session.write(request.getString("path"), input)
                "touch" -> session.touch(request.getString("path"), request.getLong("mtime"))
                "mkdir" -> session.mkdir(request.getString("path"))
                "remove" -> session.remove(request.getString("path"), dir = false)
                "rmdir" -> session.remove(request.getString("path"), dir = true)
                "rename" -> session.rename(
                    request.getString("path"), request.getString("to"), request.optBoolean("replace"),
                )
                else -> throw Refusal(null, "unknown request $op")
            }
        } catch (e: Refusal) {
            e.code?.let { reply.put("code", it) }
            reply.put("error", e.message)
        } catch (e: FileNotFoundException) {
            reply.put("code", "missing").put("error", e.message ?: "not there")
        } catch (e: SecurityException) {
            reply.put("code", "denied").put("error", e.message ?: "not allowed")
        } catch (e: Exception) {
            // Providers throw what they like, IllegalArgumentException and
            // UnsupportedOperationException among them.
            reply.put("error", "${e.javaClass.simpleName}: ${e.message}")
        }
        // The engine sends a whole file before it reads the answer, so a
        // refused write still has to take it in.
        if (op == "write" && reply.has("error")) {
            try {
                readChunks(input, nowhere)
            } catch (_: IOException) {
            }
        }
        output.write((reply.toString() + "\n").toByteArray())
        body?.use { writeChunks(it, DataOutputStream(output)) }
        output.flush()
    }

    private val nowhere = object : OutputStream() {
        override fun write(b: Int) {}
        override fun write(b: ByteArray, off: Int, len: Int) {}
    }

    private fun readLine(input: InputStream): String {
        val line = ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b == -1 || b == '\n'.code) break
            line.write(b)
        }
        return line.toString(Charsets.UTF_8.name())
    }

    private fun writeChunks(from: InputStream, to: DataOutputStream) {
        val buf = ByteArray(CHUNK)
        while (true) {
            val n = from.read(buf)
            if (n == -1) break
            if (n == 0) continue
            to.writeInt(n)
            to.write(buf, 0, n)
        }
        to.writeInt(0)
    }

    private fun readChunks(from: DataInputStream, to: OutputStream) {
        val buf = ByteArray(CHUNK)
        while (true) {
            val n = from.readInt()
            if (n == 0) return
            if (n < 0 || n > CHUNK) throw IOException("a chunk of $n bytes")
            from.readFully(buf, 0, n)
            to.write(buf, 0, n)
        }
    }

    /** One document: where it is and what its provider says about it. */
    private class Doc(
        val tree: Uri,
        val id: String,
        val name: String,
        val dir: Boolean,
        val size: Long,
        val modified: Long,
        val flags: Int,
    ) {
        val uri: Uri get() = DocumentsContract.buildDocumentUriUsingTree(tree, id)
    }

    /** Answers one request against the folders as they are now. */
    private class Session(val context: Context, val folders: List<Folder>) {
        private val resolver: ContentResolver = context.contentResolver
        private val times = context.getSharedPreferences(TIMES, Context.MODE_PRIVATE)

        private fun parts(path: String) = path.split('/').filter { it.isNotEmpty() }

        private fun row(tree: Uri, c: Cursor) = Doc(
            tree,
            id = c.getString(0),
            name = c.getString(1) ?: c.getString(0),
            dir = c.getString(2) == Document.MIME_TYPE_DIR,
            size = if (c.isNull(3)) 0 else c.getLong(3),
            modified = if (c.isNull(4)) 0 else c.getLong(4),
            flags = if (c.isNull(5)) 0 else c.getInt(5),
        )

        private fun query(tree: Uri, id: String): Doc =
            resolver.query(DocumentsContract.buildDocumentUriUsingTree(tree, id), COLUMNS, null, null, null)
                ?.use { if (it.moveToFirst()) row(tree, it) else null }
                ?: throw missing(id)

        private fun children(dir: Doc): List<Doc> {
            val uri = DocumentsContract.buildChildDocumentsUriUsingTree(dir.tree, dir.id)
            val found = ArrayList<Doc>()
            resolver.query(uri, COLUMNS, null, null, null)?.use { c ->
                while (c.moveToNext()) found.add(row(dir.tree, c))
            }
            return found
        }

        private fun child(dir: Doc, name: String): Doc? = children(dir).firstOrNull { it.name == name }

        /** The document at path, or null for the top level that lists the folders. */
        fun find(path: String): Doc? {
            val parts = parts(path)
            if (parts.isEmpty()) return null
            val folder = folders.firstOrNull { it.name == parts[0] } ?: throw missing(path)
            var doc = query(folder.uri, DocumentsContract.getTreeDocumentId(folder.uri))
            for (part in parts.drop(1)) {
                if (!doc.dir) throw missing(path)
                doc = child(doc, part) ?: throw missing(path)
            }
            return doc
        }

        /** The folder that holds path and the name path ends in. */
        private fun parent(path: String): Pair<Doc, String> {
            val parts = parts(path)
            if (parts.size < 2) throw denied("only Android adds and removes the shared folders themselves")
            val dir = find(parts.dropLast(1).joinToString("/")) ?: throw missing(path)
            if (!dir.dir) throw missing(path)
            return dir to parts.last()
        }

        private fun key(doc: Doc) = "${doc.tree}|${doc.id}"

        /** The time to report: the one asked for, while the file is as it was then. */
        private fun mtime(doc: Doc): Long {
            if (doc.dir) return doc.modified
            val kept = times.getString(key(doc), null)?.split(':')?.mapNotNull { it.toLongOrNull() }
            if (kept != null && kept.size == 3 && kept[1] == doc.modified && kept[2] == doc.size) return kept[0]
            return doc.modified
        }

        private fun json(name: String, doc: Doc?) = JSONObject()
            .put("name", name)
            .put("dir", doc?.dir ?: true)
            .put("size", if (doc == null || doc.dir) 0 else doc.size)
            .put("mtime", if (doc == null) 0 else mtime(doc))

        fun stat(path: String): JSONObject {
            val doc = find(path) ?: return json("/", null)
            // A shared folder goes by its name in the target, which can carry a number.
            return json(parts(path).last(), doc)
        }

        fun list(path: String): JSONArray {
            val doc = find(path)
            val out = JSONArray()
            if (doc == null) {
                for (folder in folders) {
                    val root = try {
                        query(folder.uri, DocumentsContract.getTreeDocumentId(folder.uri))
                    } catch (e: Exception) {
                        // The app was uninstalled, or took its folder back.
                        continue
                    }
                    out.put(json(folder.name, root))
                }
                return out
            }
            if (!doc.dir) throw missing(path)
            for (child in children(doc)) out.put(json(child.name, child))
            return out
        }

        fun read(path: String): InputStream {
            val doc = find(path) ?: throw denied("the top level is not a file")
            if (doc.dir) throw denied("$path is a folder")
            return resolver.openInputStream(doc.uri) ?: throw missing(path)
        }

        fun write(path: String, body: DataInputStream) {
            val (dir, name) = parent(path)
            val existing = child(dir, name)
            if (existing != null && existing.dir) throw denied("$path is a folder")
            val uri = existing?.uri ?: create(dir, name, "application/octet-stream")
            try {
                open(uri).use { readChunks(body, it) }
            } catch (e: Exception) {
                // A new file left half written would pass for the real one.
                if (existing == null) DocumentsContract.deleteDocument(resolver, uri)
                throw e
            }
        }

        /** Truncating where the provider knows how; plain "w" does not on every one. */
        private fun open(uri: Uri): OutputStream = try {
            resolver.openOutputStream(uri, "wt")
        } catch (e: IllegalArgumentException) {
            resolver.openOutputStream(uri, "w")
        } catch (e: FileNotFoundException) {
            resolver.openOutputStream(uri, "w")
        } ?: throw denied("cannot write $uri")

        /** Makes a document and checks the provider kept its name. */
        private fun create(dir: Doc, name: String, mime: String): Uri {
            val uri = DocumentsContract.createDocument(resolver, dir.uri, mime, name)
                ?: throw denied("${dir.name} takes no new files")
            val made = query(dir.tree, DocumentsContract.getDocumentId(uri))
            if (made.name != name) {
                DocumentsContract.deleteDocument(resolver, uri)
                throw denied("the app would name $name ${made.name}")
            }
            return uri
        }

        fun touch(path: String, mtime: Long) {
            val doc = find(path) ?: return
            if (doc.dir) return
            times.edit().putString(key(doc), "$mtime:${doc.modified}:${doc.size}").apply()
        }

        fun mkdir(path: String) {
            val (dir, name) = parent(path)
            if (child(dir, name) != null) throw Refusal(null, "$path already exists")
            create(dir, name, Document.MIME_TYPE_DIR)
        }

        fun remove(path: String, dir: Boolean) {
            parent(path)
            val doc = find(path) ?: throw missing(path)
            if (doc.dir != dir) throw denied(if (dir) "$path is a file" else "$path is a folder")
            if (dir && children(doc).isNotEmpty()) throw Refusal(null, "$path is not empty")
            if (!DocumentsContract.deleteDocument(resolver, doc.uri)) throw denied("cannot remove $path")
            times.edit().remove(key(doc)).apply()
        }

        fun rename(path: String, to: String, replace: Boolean) {
            val (fromDir, _) = parent(path)
            val doc = find(path) ?: throw missing(path)
            val (toDir, name) = parent(to)
            if (toDir.tree != fromDir.tree) throw denied("$path and $to are in different shared folders")
            child(toDir, name)?.let { there ->
                if (!replace || there.dir) throw Refusal(null, "$to already exists")
                DocumentsContract.deleteDocument(resolver, there.uri)
            }
            val kept = times.getString(key(doc), null)
            var uri = doc.uri
            if (toDir.id != fromDir.id) {
                uri = if (doc.flags and Document.FLAG_SUPPORTS_MOVE != 0) {
                    DocumentsContract.moveDocument(resolver, uri, fromDir.uri, toDir.uri)
                } else {
                    copy(doc, toDir)
                } ?: throw denied("cannot move $path")
            }
            val now = query(doc.tree, DocumentsContract.getDocumentId(uri))
            if (now.name != name) {
                uri = DocumentsContract.renameDocument(resolver, uri, name) ?: uri
            }
            times.edit().remove(key(doc)).apply()
            if (kept != null) {
                val moved = query(doc.tree, DocumentsContract.getDocumentId(uri))
                times.edit().putString(key(moved), kept).apply()
            }
        }

        /** Moves a file by copying it, for providers that cannot move. */
        private fun copy(doc: Doc, toDir: Doc): Uri {
            if (doc.dir) throw denied("the app cannot move folders")
            val uri = create(toDir, doc.name, "application/octet-stream")
            resolver.openInputStream(doc.uri)!!.use { from -> open(uri).use { from.copyTo(it) } }
            DocumentsContract.deleteDocument(resolver, doc.uri)
            return uri
        }
    }

    /** The system's folder picker. */
    fun pickIntent(): Intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION or
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
    )

    /** Whether some app on the phone answers the folder picker. */
    fun canPick(context: Context): Boolean =
        context.packageManager.queryIntentActivities(pickIntent(), PackageManager.MATCH_DEFAULT_ONLY).isNotEmpty()
}
