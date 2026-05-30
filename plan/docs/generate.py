#!/usr/bin/env python3
"""
Convert markdown files to HTML with mermaid support and fullscreen flowcharts.
"""

import re
from pathlib import Path

PLAN_DIR = Path("/workspace/github.com/LerkoX/flowx-studio/plan")
WEB_DIR = Path("/workspace/github.com/LerkoX/flowx-studio/plan/docs")

FILES = [
    ("README.md", "FlowX Studio 技术设计文档"),
    ("01-overview.md", "1. 项目概述与愿景"),
    ("02-architecture.md", "2. 系统架构设计"),
    ("03-database.md", "3. 数据库设计"),
    ("04-api.md", "4. API 设计"),
    ("05-frontend.md", "5. 前端设计"),
    ("06-ai-service.md", "6. AI 服务层设计"),
    ("07-node-system.md", "7. 节点系统与执行引擎"),
    ("08-runtime.md", "8. 运行时与部署设计"),
    ("09-security.md", "9. 安全与错误处理设计"),
    ("10-core-deps.md", "10. FlowX 核心库依赖评估"),
]


def escape_html(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def parse_inline(text):
    text = escape_html(text)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2" target="_blank">\1</a>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'\*([^*]+)\*', r'<em>\1</em>', text)
    return text


def render_mermaid(code, index):
    """Render a mermaid diagram with fullscreen support."""
    safe_code = escape_html(code)
    return f'''<div class="mermaid-container">
    <div class="mermaid-toolbar">
        <button class="mermaid-fullscreen-btn" onclick="toggleMermaidFullscreen(this)" title="全屏查看">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
            </svg>
            全屏
        </button>
    </div>
    <div class="mermaid-wrapper">
        <pre class="mermaid">{code}</pre>
    </div>
</div>'''


def markdown_to_html(md_text):
    lines = md_text.split('\n')
    html_lines = []
    i = 0
    
    in_code_block = False
    code_language = ""
    code_lines = []
    
    in_table = False
    table_rows = []
    
    in_list = False
    list_items = []
    list_ordered = False
    
    mermaid_index = 0
    
    while i < len(lines):
        line = lines[i]
        
        # Code blocks
        if line.startswith('```'):
            if not in_code_block:
                in_code_block = True
                code_language = line[3:].strip()
                code_lines = []
            else:
                in_code_block = False
                code_content = '\n'.join(code_lines)
                
                if code_language == 'mermaid':
                    mermaid_index += 1
                    html_lines.append(render_mermaid(code_content, mermaid_index))
                else:
                    lang_class = f' class="language-{code_language}"' if code_language else ''
                    html_lines.append(f'<pre><code{lang_class}>{escape_html(code_content)}</code></pre>')
            i += 1
            continue
        
        if in_code_block:
            code_lines.append(line)
            i += 1
            continue
        
        # Tables
        if '|' in line and not in_table:
            if i + 1 < len(lines) and re.match(r'^[\s|:-]+$', lines[i + 1]):
                in_table = True
                table_rows = [line]
                i += 1
                continue
        
        if in_table:
            if '|' in line:
                table_rows.append(line)
                i += 1
                continue
            else:
                in_table = False
                html_lines.append(render_table(table_rows))
                continue
        
        # Lists
        unordered_match = re.match(r'^(\s*)[-*+]\s+(.+)$', line)
        ordered_match = re.match(r'^(\s*)\d+\.\s+(.+)$', line)
        
        if unordered_match or ordered_match:
            if not in_list:
                in_list = True
                list_items = []
                list_ordered = bool(ordered_match)
            
            content = unordered_match.group(2) if unordered_match else ordered_match.group(2)
            list_items.append(parse_inline(content))
            i += 1
            continue
        elif in_list and line.strip() == '':
            in_list = False
            tag = 'ol' if list_ordered else 'ul'
            items_html = '\n'.join(f'<li>{item}</li>' for item in list_items)
            html_lines.append(f'<{tag}>\n{items_html}\n</{tag}>')
            i += 1
            continue
        elif in_list:
            in_list = False
            tag = 'ol' if list_ordered else 'ul'
            items_html = '\n'.join(f'<li>{item}</li>' for item in list_items)
            html_lines.append(f'<{tag}>\n{items_html}\n</{tag}>')
            continue
        
        # Empty line
        if line.strip() == '':
            html_lines.append('')
            i += 1
            continue
        
        # Headers
        header_match = re.match(r'^(#{1,6})\s+(.+)$', line)
        if header_match:
            level = len(header_match.group(1))
            content = parse_inline(header_match.group(2))
            anchor = re.sub(r'[^\w\s-]', '', header_match.group(2)).strip().replace(' ', '-').lower()
            anchor = re.sub(r'-+', '-', anchor)
            html_lines.append(f'<h{level} id="{anchor}">{content}</h{level}>')
            i += 1
            continue
        
        # Blockquote
        if line.startswith('>'):
            content = parse_inline(line[1:].strip())
            html_lines.append(f'<blockquote>{content}</blockquote>')
            i += 1
            continue
        
        # Horizontal rule
        if re.match(r'^[-*_]{3,}$', line.strip()):
            html_lines.append('<hr>')
            i += 1
            continue
        
        # Regular paragraph
        html_lines.append(f'<p>{parse_inline(line)}</p>')
        i += 1
    
    # Close any open blocks
    if in_code_block:
        code_content = '\n'.join(code_lines)
        if code_language == 'mermaid':
            mermaid_index += 1
            html_lines.append(render_mermaid(code_content, mermaid_index))
        else:
            lang_class = f' class="language-{code_language}"' if code_language else ''
            html_lines.append(f'<pre><code{lang_class}>{escape_html(code_content)}</code></pre>')
    
    if in_table:
        html_lines.append(render_table(table_rows))
    
    if in_list:
        tag = 'ol' if list_ordered else 'ul'
        items_html = '\n'.join(f'<li>{item}</li>' for item in list_items)
        html_lines.append(f'<{tag}>\n{items_html}\n</{tag}>')
    
    return '\n'.join(html_lines)


def render_table(rows):
    if len(rows) < 2:
        return ''
    
    header_cells = [cell.strip() for cell in rows[0].split('|')]
    header_cells = [c for c in header_cells if c]
    
    data_rows = []
    for row in rows[2:]:
        cells = [cell.strip() for cell in row.split('|')]
        cells = [c for c in cells if c]
        data_rows.append(cells)
    
    html = '<table>\n<thead>\n<tr>\n'
    for cell in header_cells:
        html += f'<th>{parse_inline(cell)}</th>\n'
    html += '</tr>\n</thead>\n<tbody>\n'
    
    for row in data_rows:
        html += '<tr>\n'
        for i, cell in enumerate(row):
            if i < len(header_cells):
                html += f'<td>{parse_inline(cell)}</td>\n'
        html += '</tr>\n'
    
    html += '</tbody>\n</table>'
    return html


def generate_nav(current_file):
    nav = '<nav class="sidebar">\n'
    nav += '<div class="nav-header">\n'
    nav += '<h2>FlowX Studio</h2>\n'
    nav += '<p>技术设计文档</p>\n'
    nav += '</div>\n'
    nav += '<ul class="nav-links">\n'
    
    for fname, title in FILES:
        active = ' class="active"' if fname == current_file else ''
        html_name = fname.replace('.md', '.html')
        nav += f'<li><a href="{html_name}"{active}>{title}</a></li>\n'
    
    nav += '</ul>\n'
    nav += '</nav>'
    return nav


def generate_page(md_file, title, content_html):
    nav = generate_nav(md_file)
    
    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title} - FlowX Studio</title>
    <link rel="stylesheet" href="style.css">
    <script type="module">
        import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
        mermaid.initialize({{
            startOnLoad: true,
            theme: 'dark',
            themeVariables: {{
                primaryColor: '#1e1e3a',
                primaryTextColor: '#e2e8f0',
                primaryBorderColor: '#6366f1',
                lineColor: '#a855f7',
                secondaryColor: '#16162a',
                tertiaryColor: '#0f0f1a',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                fontSize: '14px'
            }},
            flowchart: {{
                useMaxWidth: true,
                htmlLabels: true,
                curve: 'basis'
            }},
            sequence: {{
                useMaxWidth: true
            }},
            gantt: {{
                useMaxWidth: true
            }}
        }});
    </script>
</head>
<body>
    <div class="layout">
        {nav}
        <main class="content">
            <article>
                {content_html}
            </article>
        </main>
    </div>
    <div id="mermaid-overlay" class="mermaid-overlay" onclick="closeMermaidFullscreen(event)">
        <div class="mermaid-overlay-content">
            <button class="mermaid-close-btn" onclick="closeMermaidFullscreen(event)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                关闭
            </button>
            <div id="mermaid-overlay-diagram"></div>
            <div class="mermaid-zoom-controls">
                <button onclick="zoomOut()" title="缩小">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                </button>
                <button onclick="zoomIn()" title="放大">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                </button>
                <div class="zoom-separator"></div>
                <span id="mermaid-scale-display" class="zoom-scale">100%</span>
                <div class="zoom-separator"></div>
                <button onclick="zoomFit()" title="适应屏幕">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
                    </svg>
                </button>
                <button onclick="zoomReset()" title="原始大小">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="1 4 1 10 7 10"></polyline>
                        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                    </svg>
                </button>
            </div>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>'''
    
    return html


def main():
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    
    for md_file, title in FILES:
        md_path = PLAN_DIR / md_file
        if not md_path.exists():
            print(f"Warning: {{md_path}} not found, skipping")
            continue
        
        md_content = md_path.read_text(encoding='utf-8')
        html_content = markdown_to_html(md_content)
        
        html_file = md_file.replace('.md', '.html')
        html_path = WEB_DIR / html_file
        html_path.write_text(generate_page(md_file, title, html_content), encoding='utf-8')
        print(f"Generated: {html_path}")
    
    print("Done!")


if __name__ == '__main__':
    main()
