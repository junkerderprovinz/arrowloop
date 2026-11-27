package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

// Handler registers a route only for what the server holds when it runs, so a
// field set on the server afterwards serves nothing and the page's call to it
// gets "no such address".
func TestTheServerIsCompleteBeforeItBuildsItsRoutes(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "main.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}

	var built token.Pos
	ast.Inspect(file, func(n ast.Node) bool {
		if call, ok := n.(*ast.CallExpr); ok && onServer(call.Fun) == "Handler" {
			built = call.Pos()
		}
		return true
	})
	if built == token.NoPos {
		t.Fatal("main.go does not call server.Handler()")
	}

	ast.Inspect(file, func(n ast.Node) bool {
		assign, ok := n.(*ast.AssignStmt)
		if !ok || assign.Pos() < built {
			return true
		}
		for _, lhs := range assign.Lhs {
			if field := onServer(lhs); field != "" {
				t.Errorf("%s: server.%s is set after server.Handler() built the routes", fset.Position(assign.Pos()), field)
			}
		}
		return true
	})
}

// onServer names the field or method expr selects on the variable server.
func onServer(expr ast.Expr) string {
	sel, ok := expr.(*ast.SelectorExpr)
	if !ok {
		return ""
	}
	if id, ok := sel.X.(*ast.Ident); ok && id.Name == "server" {
		return sel.Sel.Name
	}
	return ""
}
