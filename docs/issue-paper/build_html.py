#!/usr/bin/env python3
"""Self-contained Markdown -> styled HTML converter for the AiFrenz issue-paper chapter.

Renders the chapter manuscript into a single self-contained HTML file
(public/issue-paper.html) with the "Fresh Spring Dawn (봄날 새벽)" palette.
No third-party deps; handles the Markdown subset used by the manuscript:
headers, bold, inline code, tables, blockquote callouts/figure placeholders,
lists, horizontal rules, paragraphs.

Banner title/subtitle/byline are read from the YAML frontmatter so re-titling
the manuscript automatically updates the HTML.

Usage: python3 build_html.py [src.md] [out.html]
"""
import html
import re
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else "/Users/hongseong-yong/tcid-agent/docs/issue-paper/chapter-tcid-agent.md"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/Users/hongseong-yong/tcid-agent/public/issue-paper.html"


def split_frontmatter(text: str):
    meta = {}
    body = text
    if text.startswith("---"):
        m = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
        if m:
            body = text[m.end():]
            for line in m.group(1).split("\n"):
                fm = re.match(r"^([A-Za-z_]+):\s*\"?(.*?)\"?\s*$", line)
                if fm and fm.group(2):
                    meta[fm.group(1)] = fm.group(2)
    return meta, body


def inline(s: str) -> str:
    spans = []

    def stash(m):
        spans.append(m.group(1))
        return f"\x00{len(spans) - 1}\x00"

    s = re.sub(r"`([^`]+)`", stash, s)
    s = html.escape(s, quote=False)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    # italic: single-asterisk pairs remaining after bold (no asterisk/newline inside)
    s = re.sub(r"\*([^*\n]+?)\*", r"<em>\1</em>", s)

    def restore(m):
        return f"<code>{html.escape(spans[int(m.group(1))], quote=False)}</code>"

    return re.sub(r"\x00(\d+)\x00", restore, s)


def render_table(rows):
    def cells(line):
        line = line.strip()
        if line.startswith("|"):
            line = line[1:]
        if line.endswith("|"):
            line = line[:-1]
        return [c.strip() for c in line.split("|")]

    header = cells(rows[0])
    body = [cells(r) for r in rows[2:]]
    out = ['<div class="table-wrap"><table>', "<thead><tr>"]
    out += [f"<th>{inline(c)}</th>" for c in header]
    out.append("</tr></thead><tbody>")
    for r in body:
        out.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>")
    out.append("</tbody></table></div>")
    return "".join(out)


def render_blockquote(lines):
    content = [re.sub(r"^>\s?", "", ln) for ln in lines]
    text_joined = " ".join(content)
    if re.search(r"그림\s*\d", text_joined):
        cap = re.sub(r"^\*\*(.+?)\*\*$", r"\1", content[0].strip())
        return (f'<figure class="fig-placeholder"><div class="fig-frame">🖼</div>'
                f'<figcaption>{inline(cap)}</figcaption></figure>')
    title = None
    body_lines = content
    m = re.match(r"^\*\*(.+?)\*\*\s*$", content[0].strip())
    if m:
        title = m.group(1)
        body_lines = content[1:]
    parts = ['<aside class="callout">']
    if title:
        parts.append(f'<p class="callout-title">{inline(title)}</p>')
    buf_list, buf_para = [], []

    def flush_para():
        if buf_para:
            parts.append(f"<p>{inline(' '.join(buf_para).strip())}</p>")
            buf_para.clear()

    def flush_list():
        if buf_list:
            parts.append("<ul>" + "".join(f"<li>{inline(x)}</li>" for x in buf_list) + "</ul>")
            buf_list.clear()

    for ln in body_lines:
        st = ln.strip()
        if not st:
            flush_para(); flush_list(); continue
        if st.startswith("- "):
            flush_para(); buf_list.append(st[2:])
        else:
            flush_list(); buf_para.append(st)
    flush_para(); flush_list()
    parts.append("</aside>")
    return "".join(parts)


def convert(md: str) -> str:
    lines = md.replace("\r\n", "\n").split("\n")
    out, i, n = [], 0, len(lines)
    while i < n:
        st = lines[i].strip()
        if not st:
            i += 1; continue
        if re.match(r"^---+\s*$", st):
            out.append("<hr/>"); i += 1; continue
        m = re.match(r"^(#{1,4})\s+(.*)$", st)
        if m:
            lv = len(m.group(1))
            out.append(f"<h{lv}>{inline(m.group(2).strip())}</h{lv}>"); i += 1; continue
        if st.startswith(">"):
            blk = []
            while i < n and lines[i].strip().startswith(">"):
                blk.append(lines[i].strip()); i += 1
            out.append(render_blockquote(blk)); continue
        if st.startswith("|"):
            tbl = []
            while i < n and lines[i].strip().startswith("|"):
                tbl.append(lines[i]); i += 1
            out.append(render_table(tbl)); continue
        if st.startswith("- "):
            items = []
            while i < n and lines[i].strip().startswith("- "):
                items.append(lines[i].strip()[2:]); i += 1
            out.append("<ul>" + "".join(f"<li>{inline(x)}</li>" for x in items) + "</ul>"); continue
        para = []
        while i < n:
            ls = lines[i].strip()
            if (not ls) or ls.startswith(("#", ">", "|", "- ")) or re.match(r"^---+\s*$", ls):
                break
            para.append(ls); i += 1
        out.append(f"<p>{inline(' '.join(para))}</p>")
    return "\n".join(out)


TEMPLATE = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>__TITLE__ · AiFrenz 이슈페이퍼</title>
<meta name="description" content="__SUB__"/>
<style>
:root{
  --ink:#26324a; --ink-soft:#54607a; --muted:#8a93a8;
  --blue:#5b8fd6; --blue-deep:#345a99;
  --pink:#e98aab; --pink-soft:#fbeef2;
  --mint:#6cc3ab; --mint-soft:#e6f5f0;
  --lav:#a78fd6; --lav-soft:#efe9fb;
  --cream:#fdf6ec; --paper:#ffffff; --line:#e7e2d8;
}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{
  font-family:"Pretendard",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif;
  color:var(--ink); line-height:1.78; letter-spacing:-0.003em;
  background:linear-gradient(160deg,#eaf2fb 0%,#fdf6ec 46%,#fbeef2 100%);
  background-attachment:fixed; -webkit-font-smoothing:antialiased;
}
.banner{position:relative;overflow:hidden;padding:64px 24px 92px;text-align:center;}
.banner svg{position:absolute;left:0;bottom:-1px;width:100%;height:92px;display:block;}
.eyebrow{display:inline-block;font-size:.82rem;font-weight:700;letter-spacing:.14em;
  color:var(--blue-deep);background:rgba(255,255,255,.6);border:1px solid rgba(91,143,214,.3);
  padding:6px 14px;border-radius:999px;margin-bottom:18px;}
.banner h1{margin:.1em auto .22em;max-width:20ch;font-size:2.0rem;line-height:1.34;font-weight:800;color:var(--ink);}
.banner .sub{color:var(--ink-soft);font-size:1.04rem;margin:0 auto;max-width:36ch;}
.byline{margin-top:20px;font-size:.95rem;color:var(--ink-soft);}
.byline b{color:var(--blue-deep);}
main{max-width:780px;margin:-48px auto 80px;padding:0 20px;position:relative;z-index:2;}
.card{background:var(--paper);border:1px solid var(--line);border-radius:22px;
  box-shadow:0 24px 60px -28px rgba(52,90,153,.35),0 4px 14px -8px rgba(0,0,0,.08);
  padding:54px 56px 60px;}
h1,h2,h3{line-height:1.42;color:var(--ink);}
.card>h1:first-child{display:none;}
h2{font-size:1.42rem;font-weight:800;margin:2.4em 0 .7em;padding-left:16px;position:relative;}
h2::before{content:"";position:absolute;left:0;top:.18em;bottom:.18em;width:6px;border-radius:6px;
  background:linear-gradient(180deg,var(--mint),var(--lav));}
h3{font-size:1.12rem;font-weight:750;margin:2em 0 .5em;color:var(--blue-deep);}
p{margin:.85em 0;}
strong{font-weight:750;color:var(--ink);}
hr{border:none;height:1px;background:linear-gradient(90deg,transparent,var(--line),transparent);margin:2.6em 0;}
a{color:var(--blue-deep);text-decoration:none;border-bottom:1px solid rgba(52,90,153,.3);}
code{font-family:"SFMono-Regular",ui-monospace,Menlo,Consolas,monospace;font-size:.86em;
  background:var(--lav-soft);color:#5b46a0;padding:.12em .42em;border-radius:6px;border:1px solid rgba(167,143,214,.28);}
ul{margin:.7em 0;padding-left:1.3em;} li{margin:.3em 0;} li::marker{color:var(--mint);}
.table-wrap{overflow-x:auto;margin:1.3em 0;border-radius:14px;border:1px solid var(--line);}
table{border-collapse:collapse;width:100%;font-size:.95rem;}
thead th{background:linear-gradient(180deg,#eef4fc,#e6eef9);color:var(--blue-deep);font-weight:750;
  text-align:left;padding:11px 14px;border-bottom:2px solid rgba(91,143,214,.25);}
tbody td{padding:10px 14px;border-bottom:1px solid #f0ece3;vertical-align:top;}
tbody tr:nth-child(even){background:#fbfaf7;}
tbody tr:last-child td{border-bottom:none;}
.callout{margin:1.5em 0;padding:18px 22px;border-radius:16px;
  background:linear-gradient(135deg,var(--lav-soft),var(--pink-soft));
  border:1px solid rgba(167,143,214,.28);border-left:5px solid var(--lav);}
.callout-title{margin:.1em 0 .5em;font-weight:800;color:#7a5fb8;font-size:1.02rem;}
.callout p{margin:.45em 0;} .callout ul{margin:.4em 0;}
.fig-placeholder{margin:1.7em 0;text-align:center;}
.fig-frame{height:128px;border:2px dashed rgba(91,143,214,.4);border-radius:14px;
  background:repeating-linear-gradient(45deg,#f4f8fd,#f4f8fd 12px,#eef4fc 12px,#eef4fc 24px);
  display:flex;align-items:center;justify-content:center;font-size:2rem;opacity:.7;}
.fig-placeholder figcaption{margin-top:10px;font-size:.9rem;color:var(--muted);font-weight:600;}
.footer{max-width:780px;margin:0 auto;padding:0 20px 70px;text-align:center;color:var(--ink-soft);}
.footer .quote{font-size:1.05rem;font-weight:600;color:var(--ink);max-width:32ch;margin:0 auto 14px;line-height:1.7;}
.footer .meta{font-size:.85rem;color:var(--muted);}
@media(max-width:640px){
  .banner h1{font-size:1.55rem;} .card{padding:34px 22px 40px;border-radius:16px;} main{margin-top:-36px;}
}
@media print{
  body{background:#fff;} .banner svg{display:none;}
  .card{box-shadow:none;border:none;padding:0;}
  .callout,.fig-placeholder,table{break-inside:avoid;}
}
</style>
</head>
<body>
<header class="banner">
  <span class="eyebrow">__EYEBROW__</span>
  <h1>__TITLE__</h1>
  <p class="sub">__SUB__</p>
  <p class="byline"><b>__AUTHOR__</b> · __AFFIL__ &nbsp;|&nbsp; __PUBLISHER__ &nbsp;|&nbsp; __LICENSE__</p>
  <svg viewBox="0 0 1440 92" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,40 C320,92 520,10 760,42 C1020,80 1180,28 1440,52 L1440,92 L0,92 Z" fill="#ffffff" opacity="0.92"/>
    <path d="M0,60 C300,100 560,22 820,56 C1080,92 1240,40 1440,62 L1440,92 L0,92 Z" fill="#ffffff"/>
  </svg>
</header>
<main><article class="card">
__BODY__
</article></main>
<footer class="footer">
  <p class="quote">__QUOTE__</p>
  <p class="meta">__FOOTMETA__</p>
</footer>
</body>
</html>
"""


def main():
    with open(SRC, "r", encoding="utf-8") as f:
        raw = f.read()
    meta, body_md = split_frontmatter(raw)
    body = convert(body_md)
    repl = {
        "__TITLE__": meta.get("title", "AiFrenz 이슈페이퍼"),
        "__SUB__": meta.get("subtitle", ""),
        "__EYEBROW__": meta.get("series", "AiFrenz 이슈페이퍼") + (f" · CHAPTER {meta['chapter']}" if meta.get("chapter") else ""),
        "__AUTHOR__": meta.get("author_name", "홍성용"),
        "__AFFIL__": meta.get("author_affiliation", "[소속]"),
        "__PUBLISHER__": meta.get("publisher", "AiFrenz 학회 산하 교육AI연구회"),
        "__LICENSE__": meta.get("license", "CC BY 4.0"),
        "__QUOTE__": meta.get("pull_quote", "교사의 주도성은 AI가 대신할 수 없다. AI는 그 주도성을 더 멀리 가게 도울 뿐이다."),
        "__FOOTMETA__": "AiFrenz 교육AI연구회 · 하반기 이슈페이퍼(제2호) 기고 · 미리보기 문서",
        "__BODY__": body,
    }
    out = TEMPLATE
    for k, v in repl.items():
        out = out.replace(k, v)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"WROTE {OUT} ({len(out)} bytes)")


if __name__ == "__main__":
    main()
