package volume

import (
	"reflect"
	"strings"
	"testing"
)

// What a Docker container on Unraid sees in /proc/self/mountinfo.
const containerMounts = `1430 1170 0:313 / / rw,relatime master:525 - overlay overlay rw,lowerdir=/var/lib/docker/overlay2/l/A
1431 1430 0:316 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw
1432 1430 0:317 / /dev rw,nosuid - tmpfs tmpfs rw,size=65536k,mode=755
1433 1432 0:318 / /dev/pts rw,nosuid,noexec,relatime - devpts devpts rw
1434 1430 0:319 / /sys ro,nosuid,nodev,noexec,relatime - sysfs sysfs ro
1436 1432 0:315 / /dev/mqueue rw - mqueue mqueue rw
1437 1430 0:45 /user/appdata/arrowloop /config rw,noatime - shfs shfs rw
1438 1430 0:45 /user/data /data rw,noatime - shfs shfs rw
1439 1430 8:1 /docker/containers/abc/resolv.conf /etc/resolv.conf rw - btrfs /dev/loop2 rw
1440 1430 8:1 /docker/containers/abc/hostname /etc/hostname rw - btrfs /dev/loop2 rw
1441 1430 8:1 /docker/containers/abc/hosts /etc/hosts rw - btrfs /dev/loop2 rw
1442 1432 0:314 / /dev/shm rw - tmpfs shm rw
1171 1431 0:316 /bus /proc/bus ro - proc proc rw
`

// What a Linux desktop sees with a USB stick, a backup disk, a CD, an SMB
// share and an sshfs mount in the home folder.
const desktopMounts = `22 1 259:2 / / rw,relatime shared:1 - ext4 /dev/nvme0n1p2 rw
23 22 259:1 / /boot/efi rw - vfat /dev/nvme0n1p1 rw
24 22 259:3 / /home rw - ext4 /dev/nvme0n1p3 rw
80 24 0:50 / /home/alex/nas rw,nosuid,nodev - fuse.sshfs alex@nas:/ rw
81 24 0:51 / /home/alex/.cache/doc rw - fuse.portal portal rw
82 24 0:52 / /home/alex/.gvfs rw - fuse.gvfsd-fuse gvfsd-fuse rw
90 22 8:17 / /media/alex/USB\040STICK rw - vfat /dev/sdb1 rw
91 22 8:33 / /run/media/alex/Backup rw - ext4 /dev/sdc1 rw
92 22 0:60 / /mnt/nas rw - cifs //nas/share rw
93 22 0:61 / /run/user/1000/gvfs rw - fuse.gvfsd-fuse gvfsd-fuse rw
94 22 11:0 / /media/cdrom ro - iso9660 /dev/sr0 ro
95 90 8:17 / /media/alex/USB\040STICK rw - vfat /dev/sdb1 rw
`

func TestAContainerOffersNoneOfItsOwnMounts(t *testing.T) {
	got := offered(mountPoints(strings.NewReader(containerMounts)), "/root")
	if len(got) != 0 {
		t.Errorf("a container offered %q as drives, which are its own files and folders", got)
	}
}

func TestRemovableDisksAndSharesAreOffered(t *testing.T) {
	got := offered(mountPoints(strings.NewReader(desktopMounts)), "/home/alex")
	want := []string{"/home/alex/nas", "/media/alex/USB STICK", "/media/cdrom", "/mnt/nas", "/run/media/alex/Backup"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("offered %q, want %q", got, want)
	}
}
