import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown disallowedElements={["img"]} remarkPlugins={[remarkGfm]} skipHtml>
      {content}
    </ReactMarkdown>
  );
}
