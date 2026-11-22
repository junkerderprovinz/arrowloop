package vpnconn

import (
	"strings"
	"testing"

	_ "github.com/rclone/rclone/backend/azureblob"
	_ "github.com/rclone/rclone/backend/sftp"
	_ "github.com/rclone/rclone/backend/smb"
)

func TestWhichSidesCanGoThroughTheVPN(t *testing.T) {
	for _, c := range []struct {
		remote  string
		refused string
	}{
		{remote: ":smb,host=192.168.178.1,user=someone:share"},
		{remote: ":smb,host=nas.local,port=4450:share/backup"},
		{remote: ":smb,host=dc.example.com,use_kerberos=true:share", refused: "Kerberos"},
		{remote: ":azureblob,account=someone:box", refused: "azureblob"},
		{remote: ":sftp,host=192.0.2.10,ssh='ssh nas':", refused: "ssh command"},
	} {
		err := Unroutable(c.remote)
		switch {
		case c.refused == "" && err != nil:
			t.Errorf("%s was refused: %v", c.remote, err)
		case c.refused != "" && (err == nil || !strings.Contains(err.Error(), c.refused)):
			t.Errorf("%s: %v, want a refusal that names %s", c.remote, err, c.refused)
		}
	}
}
