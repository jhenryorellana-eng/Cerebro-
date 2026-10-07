# Control de privacidad: ningún dato de cliente puede entrar al repositorio.
# Busca en los archivos que git va a subir (texto y texto de los PDF) los términos de pii_terms.local.txt: nombres, números de
# documento, teléfonos, correos y direcciones de los clientes. Esa lista es LOCAL (está en .gitignore) y la mantiene cada usuario.
# Uso:  python scripts/control_privacidad.py            -> revisa lo que está preparado para el commit (git ls-files + staged)
#       python scripts/control_privacidad.py --todo     -> revisa todo el árbol del repositorio
# Sale con código 1 si encuentra algo. El hook .githooks/pre-commit lo ejecuta antes de cada commit.
import os, re, subprocess, sys, unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TERMS = os.path.join(RAIZ, "pii_terms.local.txt")
TEXTO = {".py", ".md", ".json", ".txt", ".ts", ".mts", ".js", ".csv", ".html", ".yml", ".yaml", ".toml", ".ini", ""}


def norm(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


def cargar():
    if not os.path.exists(TERMS):
        print("AVISO: falta pii_terms.local.txt; no se puede comprobar la privacidad. Créalo antes de subir nada.")
        sys.exit(2)
    nombres, nums = [], []
    for l in open(TERMS, encoding="utf-8"):
        l = l.strip()
        if not l or l.startswith("#"): continue
        if l.startswith("NUM:"): nums.append(l[4:])
        else: nombres.append(norm(l))
    pat = re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(n) for n in sorted(nombres, key=len, reverse=True)) + r")(?![a-z0-9])")
    return pat, set(nums)


def archivos(todo):
    if todo:
        out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=RAIZ, capture_output=True, text=True).stdout
    else:
        out = subprocess.run(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"], cwd=RAIZ, capture_output=True, text=True).stdout
    return [os.path.join(RAIZ, f) for f in out.splitlines() if f]


def texto_de(ruta):
    ext = os.path.splitext(ruta)[1].lower()
    if ext == ".pdf":
        try:
            import pypdf
            return "\n".join((p.extract_text() or "") for p in pypdf.PdfReader(ruta).pages)
        except Exception:
            return ""
    if ext in (".docx", ".dotx"):
        try:
            import zipfile
            with zipfile.ZipFile(ruta) as z:
                return re.sub(r"<[^>]+>", " ", z.read("word/document.xml").decode("utf-8", "ignore"))
        except Exception:
            return ""
    if ext in TEXTO:
        try: return open(ruta, encoding="utf-8", errors="ignore").read()
        except OSError: return ""
    return ""


def main():
    pat, nums = cargar()
    malos = 0
    for f in archivos("--todo" in sys.argv):
        if os.path.basename(f) == "pii_terms.local.txt" or not os.path.exists(f): continue
        t = texto_de(f)
        if not t: continue
        hall = {m.group(1) for m in pat.finditer(norm(t))}
        dig = re.sub(r"[ \-]", "", t)
        hall |= {"NUM:" + n for n in nums if n in dig}
        if hall:
            malos += 1
            print(f"✘ {os.path.relpath(f, RAIZ)}: {', '.join(sorted(hall))[:300]}")
    if malos:
        print(f"\n{malos} archivo(s) con datos de clientes. NO se sube nada hasta corregirlo.")
        sys.exit(1)
    print("✔ Control de privacidad: ningún dato de cliente en los archivos revisados.")


if __name__ == "__main__":
    main()
