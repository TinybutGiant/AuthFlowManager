import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { OfferLetterPreviewModel, OfferLetterPreviewToken } from "./offerLetterPreviewMapper";

interface OfferLetterDocumentPreviewProps {
  model: OfferLetterPreviewModel;
  className?: string;
}

function TokenizedText({ tokens }: { tokens: OfferLetterPreviewToken[] }) {
  return (
    <>
      {tokens.map((token, index) => {
        if (token.type === "text") {
          return <span key={`${index}-text`}>{token.text}</span>;
        }

        return (
          <span
            key={`${index}-${token.variable}`}
            className={cn(
              "mx-0.5 inline-flex max-w-full items-center rounded border px-1.5 py-0.5 align-baseline font-mono text-[0.78em] font-semibold",
              token.missing
                ? "border-amber-300 bg-amber-100 text-amber-950"
                : "border-slate-200 bg-slate-100 text-slate-700"
            )}
            title={token.label}
            data-variable={token.variable}
            data-missing={token.missing ? "true" : "false"}
          >
            {token.text}
          </span>
        );
      })}
    </>
  );
}

export function OfferLetterDocumentPreview({ model, className }: OfferLetterDocumentPreviewProps) {
  const isMerged = model.mode === "merged";

  return (
    <div className={cn("h-full overflow-auto bg-slate-100 p-4 sm:p-6", className)}>
      <div className="mx-auto min-h-[920px] w-full max-w-[816px] border border-slate-200 bg-white px-8 py-10 shadow-xl sm:px-14 sm:py-12">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Document Preview
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {isMerged
                ? "Final merged draft from server preview"
                : "Raw template preview with unresolved variables highlighted"}
            </p>
          </div>
          <Badge variant={isMerged ? "default" : "secondary"}>
            {isMerged ? "Merged" : "Template"}
          </Badge>
        </div>

        <header className="mb-9 text-center">
          <h1 className="whitespace-pre-wrap break-words text-xl font-semibold leading-tight text-slate-950">
            <TokenizedText tokens={model.titleTokens} />
          </h1>
        </header>

        <main className="whitespace-pre-wrap break-words font-serif text-[15px] leading-7 text-slate-900">
          <TokenizedText tokens={model.bodyTokens} />
        </main>
      </div>
    </div>
  );
}

export default OfferLetterDocumentPreview;
