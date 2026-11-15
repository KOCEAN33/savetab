// Package archtest holds the layout rules that an import path cannot show. The import rules
// themselves are the depguard settings in .golangci.yml.
package archtest

import (
	"go/ast"
	"go/parser"
	"go/token"
	"go/types"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"golang.org/x/tools/go/packages"
)

const pgxPath = "github.com/jackc/pgx/v5"

var (
	// mainPackages are the directories that may hold a main package. savetab-e2e is the second:
	// it prepares a test database and a fake issuer, then calls wire.Run.
	mainPackages = []string{"cmd/savetab-server", "cmd/savetab-e2e"}

	topLevel    = []string{"wire", "httpserver", "jobserver", "platform", "archtest", "api", "job", "cli", "bus", "db"}
	layers      = []string{"api", "job", "cli", "bus", "db"}
	meaningless = []string{"util", "utils", "common", "misc", "helpers", "shared"}

	// databaseCallFiles call the driver outside generated code. store.go runs the migrations
	// until step 15, and testdb goes at step 18.
	databaseCallFiles = []string{"internal/db/store.go", "internal/platform/testdb/testdb.go"}

	transactionFile = "internal/db/tx.go"

	driverTypes = []string{
		"*" + pgxPath + "/pgxpool.Pool", "*" + pgxPath + "/pgxpool.Conn", "*" + pgxPath + ".Conn", pgxPath + ".Tx",
	}
	databaseCalls    = []string{"Query", "QueryRow", "Exec", "SendBatch", "CopyFrom"}
	transactionCalls = []string{"Begin", "BeginTx", "Commit", "Rollback"}
	transactionFuncs = []string{"BeginFunc", "BeginTxFunc"}
)

// root is the module root, found by walking up to go.mod.
func root(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("no go.mod above the test")
		}
		dir = parent
	}
}

type sourceFile struct {
	// path is relative to the module root, with forward slashes.
	path string
	ast  *ast.File
}

func (f sourceFile) dir() string           { return filepath.ToSlash(filepath.Dir(f.path)) }
func (f sourceFile) test() bool            { return strings.HasSuffix(f.path, "_test.go") }
func (f sourceFile) under(dir string) bool { return strings.HasPrefix(f.path, dir+"/") }

func (f sourceFile) generated() bool { return ast.IsGenerated(f.ast) }

// sources parses every Go file of the module.
func sources(t *testing.T) []sourceFile {
	t.Helper()
	base := root(t)
	var files []sourceFile
	fset := token.NewFileSet()
	err := filepath.WalkDir(base, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if d.IsDir() {
			if path == base {
				return nil
			}
			if name == "testdata" || name == "vendor" || strings.HasPrefix(name, ".") || strings.HasPrefix(name, "_") {
				return filepath.SkipDir
			}
			if _, err := os.Stat(filepath.Join(path, "go.mod")); err == nil {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(name, ".go") {
			return nil
		}
		parsed, err := parser.ParseFile(fset, path, nil, parser.ParseComments|parser.SkipObjectResolution)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(base, path)
		if err != nil {
			return err
		}
		files = append(files, sourceFile{path: filepath.ToSlash(rel), ast: parsed})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

// subdirs returns the names of the directories directly under dir, relative to the module root.
func subdirs(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(root(t), dir))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			names = append(names, e.Name())
		}
	}
	return names
}

func TestModuleTree(t *testing.T) {
	for _, f := range sources(t) {
		if f.under("internal") {
			continue
		}
		if !slices.Contains(mainPackages, f.dir()) {
			t.Errorf("%s: a Go file outside internal/ sits directly in one of %v", f.path, mainPackages)
		}
		if f.ast.Name.Name != "main" {
			t.Errorf("%s: package %s, want main", f.path, f.ast.Name.Name)
		}
	}
}

func TestTopLevelPackages(t *testing.T) {
	for _, name := range subdirs(t, "internal") {
		if !slices.Contains(topLevel, name) {
			t.Errorf("internal/%s: a directory under internal/ is one of %v", name, topLevel)
		}
	}
}

func TestMeaninglessNames(t *testing.T) {
	for _, f := range sources(t) {
		for _, part := range strings.Split(f.dir(), "/") {
			if slices.Contains(meaningless, part) {
				t.Errorf("%s: no directory is named %s", f.path, part)
			}
		}
	}
}

// TestOneForm holds the service to the small form: each layer is one package of its own files,
// and api may hold the generated apigen beside them.
func TestOneForm(t *testing.T) {
	for _, f := range sources(t) {
		for _, layer := range layers {
			if f.under("internal/"+layer) && f.dir() != "internal/"+layer && f.dir() != "internal/api/apigen" {
				t.Errorf("%s: internal/%s holds its own files, so it holds no package under it", f.path, layer)
			}
		}
	}
}

func TestPackageClauses(t *testing.T) {
	for _, f := range sources(t) {
		if !f.under("internal") {
			continue
		}
		want := filepath.Base(f.dir())
		if got := strings.TrimSuffix(f.ast.Name.Name, "_test"); got != want {
			t.Errorf("%s: package %s, want %s", f.path, f.ast.Name.Name, want)
		}
	}
}

func TestInterfacesAtTheConsumer(t *testing.T) {
	for _, f := range sources(t) {
		if !f.under("internal/db") || f.test() || f.generated() {
			continue
		}
		ast.Inspect(f.ast, func(n ast.Node) bool {
			spec, ok := n.(*ast.TypeSpec)
			if !ok {
				return true
			}
			if _, ok := spec.Type.(*ast.InterfaceType); ok && spec.Name.IsExported() {
				t.Errorf("%s: db declares the exported interface %s, which belongs to its consumer", f.path, spec.Name.Name)
			}
			return true
		})
	}
}

func TestAPITypesApart(t *testing.T) {
	for _, f := range sources(t) {
		if !f.under("internal/bus") || f.test() {
			continue
		}
		ast.Inspect(f.ast, func(n ast.Node) bool {
			field, ok := n.(*ast.Field)
			if ok && field.Tag != nil && strings.Contains(field.Tag.Value, "json:") {
				t.Errorf("%s: a bus struct field carries a json tag %s", f.path, field.Tag.Value)
			}
			return true
		})
	}
}

var load = sync.OnceValues(func() ([]*packages.Package, error) {
	dir, err := os.Getwd()
	if err != nil {
		return nil, err
	}
	// From the test's directory, ./... would hold this package alone.
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			break
		}
		dir = filepath.Dir(dir)
	}
	return packages.Load(&packages.Config{
		Dir:  dir,
		Mode: packages.NeedName | packages.NeedModule | packages.NeedFiles | packages.NeedSyntax | packages.NeedTypes | packages.NeedTypesInfo,
	}, "./...")
})

type typedFile struct {
	path string
	ast  *ast.File
	info *types.Info
}

// typed returns the non-test files of the module with their type information.
func typed(t *testing.T) []typedFile {
	t.Helper()
	base := root(t)
	pkgs, err := load()
	if err != nil {
		t.Fatal(err)
	}
	if packages.PrintErrors(pkgs) > 0 {
		t.Fatal("the module does not load")
	}
	if len(pkgs) < len(topLevel)/2 {
		t.Fatalf("loaded %d packages, want every package of the module", len(pkgs))
	}
	var files []typedFile
	for _, pkg := range pkgs {
		for _, file := range pkg.Syntax {
			rel, err := filepath.Rel(base, pkg.Fset.Position(file.Package).Filename)
			if err != nil {
				t.Fatal(err)
			}
			files = append(files, typedFile{path: filepath.ToSlash(rel), ast: file, info: pkg.TypesInfo})
		}
	}
	return files
}

func TestDriverUses(t *testing.T) {
	for _, f := range typed(t) {
		if !strings.HasPrefix(f.path, "internal/bus/") && !strings.HasPrefix(f.path, "internal/jobserver/") {
			continue
		}
		for ident, obj := range f.info.Uses {
			if obj.Pkg() != nil && obj.Pkg().Path() == pgxPath && ident.Name != "Tx" {
				if _, ok := obj.(*types.PkgName); ok {
					continue
				}
				if ident.Pos() < f.ast.Pos() || ident.Pos() > f.ast.End() {
					continue
				}
				t.Errorf("%s: uses pgx.%s, and the only pgx identifier here is Tx", f.path, ident.Name)
			}
		}
	}
}

// driverMethod returns the name of the method call calls when its receiver, or the type that
// declares the method, is a driver type. An embedding struct does not hide the call.
func driverMethod(info *types.Info, call *ast.CallExpr) string {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return ""
	}
	selection, ok := info.Selections[sel]
	if !ok || selection.Kind() != types.MethodVal {
		return ""
	}
	fn, ok := selection.Obj().(*types.Func)
	if !ok {
		return ""
	}
	received := []string{types.TypeString(selection.Recv(), nil)}
	if recv := fn.Signature().Recv(); recv != nil {
		received = append(received, types.TypeString(recv.Type(), nil))
	}
	for _, typ := range received {
		if slices.Contains(driverTypes, typ) {
			return fn.Name()
		}
	}
	return ""
}

func TestDatabaseCalls(t *testing.T) {
	for _, f := range typed(t) {
		if ast.IsGenerated(f.ast) || f.path == "internal/db/dynamic.go" || slices.Contains(databaseCallFiles, f.path) {
			continue
		}
		ast.Inspect(f.ast, func(n ast.Node) bool {
			if call, ok := n.(*ast.CallExpr); ok {
				if name := driverMethod(f.info, call); slices.Contains(databaseCalls, name) {
					t.Errorf("%s: calls %s on the driver, which only generated queries and internal/db/dynamic.go do", f.path, name)
				}
			}
			return true
		})
	}
}

func TestTransactionCalls(t *testing.T) {
	for _, f := range typed(t) {
		if f.path == transactionFile {
			continue
		}
		ast.Inspect(f.ast, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			if name := driverMethod(f.info, call); slices.Contains(transactionCalls, name) {
				t.Errorf("%s: calls %s, and %s holds every transaction call", f.path, name, transactionFile)
			}
			if sel, ok := call.Fun.(*ast.SelectorExpr); ok {
				if fn, ok := f.info.Uses[sel.Sel].(*types.Func); ok && fn.Pkg() != nil && fn.Pkg().Path() == pgxPath && slices.Contains(transactionFuncs, fn.Name()) {
					t.Errorf("%s: calls pgx.%s, and %s holds every transaction call", f.path, fn.Name(), transactionFile)
				}
			}
			return true
		})
	}
}
