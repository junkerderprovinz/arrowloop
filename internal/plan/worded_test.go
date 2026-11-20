package plan

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// givenCodes is every reason code written out where the engine builds a
// reason: the first value of because and Because, and the fallback code
// whyFailed is handed.
func givenCodes(t *testing.T) map[string]string {
	t.Helper()
	codes := map[string]string{}
	set := token.NewFileSet()
	err := filepath.WalkDir("..", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		file, err := parser.ParseFile(set, path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(file, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			at := -1
			switch fun := call.Fun.(type) {
			case *ast.Ident:
				switch fun.Name {
				case "because":
					at = 0
				case "whyFailed":
					at = 3
				}
			case *ast.SelectorExpr:
				if fun.Sel.Name == "Because" {
					at = 0
				}
			}
			if at < 0 || at >= len(call.Args) {
				return true
			}
			if lit, ok := call.Args[at].(*ast.BasicLit); ok && lit.Kind == token.STRING {
				code, _ := strconv.Unquote(lit.Value)
				codes[code] = set.Position(lit.Pos()).String()
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return codes
}

// A code without a sentence prints as the code itself on the command line,
// and an interface that does not know it has nothing better to fall back on.
func TestEveryReasonTheEngineGivesHasAnEnglishSentence(t *testing.T) {
	codes := givenCodes(t)
	if len(codes) < len(reasonText)/2 {
		t.Fatalf("found only %d codes in the engine, so the search is blind", len(codes))
	}
	for code, where := range codes {
		if reasonText[code] == "" {
			t.Errorf("%s gives %q, which has no sentence", where, code)
		}
	}
}
