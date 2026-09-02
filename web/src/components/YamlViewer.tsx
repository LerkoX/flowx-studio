import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import yamlLang from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

// PrismLight 按需注册，避免引入全量语言包
SyntaxHighlighter.registerLanguage('yaml', yamlLang)

/**
 * YAML 语法高亮查看器（只读）。
 * 背景透明以融入 GlassPanel，等宽字体与画布面板风格保持一致
 */
export default function YamlViewer({ code }: { code: string }) {
  return (
    <SyntaxHighlighter
      language="yaml"
      style={oneDark}
      customStyle={{
        background: 'transparent',
        margin: 0,
        padding: 0,
        fontSize: '12px',
        lineHeight: 1.6,
      }}
      codeTagProps={{
        style: {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        },
      }}
      wrapLongLines={true}
    >
      {code}
    </SyntaxHighlighter>
  )
}
