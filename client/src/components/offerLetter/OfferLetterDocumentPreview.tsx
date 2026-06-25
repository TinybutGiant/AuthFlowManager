import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  parseOfferLetterPlainText,
  stripLegacyOfferLetterTextHeader,
  type OfferLetterPlainTextBlock,
} from "@shared/offerLetterPlainTextParser";
import {
  tokenizeOfferLetterTemplateText,
  type OfferLetterPreviewModel,
  type OfferLetterPreviewToken,
} from "./offerLetterPreviewMapper";

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

function tokensForBlockText(model: OfferLetterPreviewModel, text: string) {
  const missingVariables = new Set(model.missingFields.map((field) => field.variable));
  return tokenizeOfferLetterTemplateText(text, model.mode === "merged" ? new Set<string>() : missingVariables);
}

function previewMergeString(model: OfferLetterPreviewModel, key: string) {
  const value = model.serverPreview?.merge_data?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function PreviewLetterhead({ model }: { model: OfferLetterPreviewModel }) {
  const brandDefaults = model.serverPreview?.company_brand_defaults;
  if (!brandDefaults) return null;
  const workLocation = previewMergeString(model, "work_location") || brandDefaults.defaultWorkLocation;

  return (
    <div className="mb-8 border-b border-slate-200 pb-5 text-center">
      <p className="text-[16px] font-semibold leading-snug text-slate-950">
        {brandDefaults.companyName}
      </p>
      <p className="mt-1 text-[13px] leading-snug text-slate-600">
        {workLocation}
      </p>
    </div>
  );
}

function ParsedBlock({ block, model }: { block: OfferLetterPlainTextBlock; model: OfferLetterPreviewModel }) {
  switch (block.type) {
    case "blankLine":
      return <div className="h-2" aria-hidden="true" />;
    case "sectionHeading":
      return (
        <h2 className="mb-2 mt-6 text-[16px] font-semibold leading-snug text-slate-950">
          {block.marker ? `${block.marker}. ` : ""}
          <TokenizedText tokens={tokensForBlockText(model, block.text)} />
        </h2>
      );
    case "bulletList":
      return (
        <ul className="my-3 list-disc space-y-1 pl-7">
          {block.items.map((item, index) => (
            <li key={`${index}-${item.slice(0, 16)}`} className="pl-1 leading-[1.45]">
              <TokenizedText tokens={tokensForBlockText(model, item)} />
            </li>
          ))}
        </ul>
      );
    case "numberedList":
      return (
        <ol className="my-3 list-decimal space-y-1 pl-7">
          {block.items.map((item) => (
            <li key={`${item.marker}-${item.text.slice(0, 16)}`} className="pl-1 leading-[1.45]">
              <TokenizedText tokens={tokensForBlockText(model, item.text)} />
            </li>
          ))}
        </ol>
      );
    case "signatureBlock":
      return (
        <div className="mt-10 space-y-1 leading-[1.45]">
          {block.lines.map((line, index) => (
            <p key={`${index}-${line}`} className={index === 0 ? "mb-5" : undefined}>
              <TokenizedText tokens={tokensForBlockText(model, line)} />
            </p>
          ))}
        </div>
      );
    case "acknowledgmentBlock":
      return (
        <div className="mt-8 border-t border-slate-200 pt-5 leading-[1.45]">
          {block.lines.map((line, index) => (
            <p key={`${index}-${line}`} className={index === 0 ? "font-semibold text-slate-950" : "mt-2"}>
              <TokenizedText tokens={tokensForBlockText(model, line)} />
            </p>
          ))}
        </div>
      );
    case "paragraph":
    default:
      return (
        <p className="mb-3 whitespace-pre-wrap leading-[1.45]">
          <TokenizedText tokens={tokensForBlockText(model, block.text)} />
        </p>
      );
  }
}

export function OfferLetterDocumentPreview({ model, className }: OfferLetterDocumentPreviewProps) {
  const isMerged = model.mode === "merged";
  const brandDefaults = model.serverPreview?.company_brand_defaults;
  const bodyText = brandDefaults
    ? stripLegacyOfferLetterTextHeader(model.body, {
        companyName: brandDefaults.companyName,
        workLocation: previewMergeString(model, "work_location") || brandDefaults.defaultWorkLocation,
      })
    : model.body;
  const bodyBlocks = parseOfferLetterPlainText(bodyText);

  return (
    <div className={cn("h-full overflow-auto bg-slate-100 p-4 sm:p-6", className)}>
      <div className="mx-auto mb-3 flex w-full max-w-[816px] flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span>
          {isMerged
            ? "Final merged draft from server preview"
            : "Raw template preview with unresolved variables highlighted"}
        </span>
        <Badge variant={isMerged ? "default" : "secondary"}>
          {isMerged ? "Merged" : "Template"}
        </Badge>
      </div>

      <div className="mx-auto min-h-[960px] w-full max-w-[816px] border border-slate-200 bg-white px-8 py-10 shadow-xl sm:px-[64px] sm:py-[64px]">
        <PreviewLetterhead model={model} />

        <header className="mb-8 text-center">
          <h1 className="whitespace-pre-wrap break-words text-[20px] font-semibold leading-tight text-slate-950">
            <TokenizedText tokens={model.titleTokens} />
          </h1>
        </header>

        <div className="break-words font-serif text-[15px] leading-[1.45] text-slate-900">
          {bodyBlocks.map((block, index) => (
            <ParsedBlock key={`${index}-${block.type}`} block={block} model={model} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default OfferLetterDocumentPreview;
