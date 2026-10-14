"""Build content/near-forms.json: every real Russian word form (OpenRussian, CC BY-SA 4.0)
that is one edit away from a word used in the course. The app uses it for the typo rule
(01-user-flow.md §6 rule 3): a one-letter slip is only forgiven when the typed word is not
another real form. Usage: python3 scripts/real_forms.py <dict-dir> <lessons-dir> <out.json>"""
import csv, glob, json, os, re, sys

dict_dir, lessons_dir, out = sys.argv[1:4]
ALPHA = "абвгдежзийклмнопрстуфхцчшщъыьэюя-"
WORD = re.compile(r"[а-яё-]+")

def norm(w):
    return w.lower().replace("'", "").replace("́", "").replace("ё", "е").strip()

forms = set()
csv.field_size_limit(10**7)
for f in ("nouns.csv", "verbs.csv", "adjectives.csv", "others.csv"):
    with open(os.path.join(dict_dir, f), encoding="utf-8") as fh:
        r = csv.reader(fh, delimiter="\t")
        header = next(r)
        skip = {i for i, h in enumerate(header) if h.startswith("translations") or h in ("gender", "aspect", "animate", "indeclinable", "sg_only", "pl_only", "partner")}
        for row in r:
            for i, cell in enumerate(row):
                if i in skip or not cell:
                    continue
                for part in re.split(r"[,;/ ]+", cell):
                    p = norm(part)
                    if p and WORD.fullmatch(p):
                        forms.add(p)
print("dictionary forms:", len(forms))

def strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, list):
        for x in o: yield from strings(x)
    elif isinstance(o, dict):
        for k, v in o.items():
            if k in ("en", "accept_en", "translit", "question", "title", "explanation", "sound", "goal", "prompt_en", "uses", "kind", "say", "note", "pos", "id"):
                continue
            yield from strings(v)

tokens = set()
for f in glob.glob(os.path.join(lessons_dir, "*.json")):
    for s in strings(json.load(open(f, encoding="utf-8"))):
        for t in WORD.findall(norm(s)):
            if len(t) >= 5:
                tokens.add(t)
print("course tokens >= 5 letters:", len(tokens))

def edits1(w):
    splits = [(w[:i], w[i:]) for i in range(len(w) + 1)]
    out = set()
    for a, b in splits:
        if b:
            out.add(a + b[1:])
            for c in ALPHA: out.add(a + c + b[1:])
        if len(b) > 1:
            out.add(a + b[1] + b[0] + b[2:])
        for c in ALPHA: out.add(a + c + b)
    out.discard(w)
    return out

near = set()
for t in tokens:
    near |= edits1(t) & forms
near |= tokens & forms
json.dump(sorted(near), open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("near forms written:", len(near))
