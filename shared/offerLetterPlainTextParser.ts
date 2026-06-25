export type OfferLetterPlainTextBlock =
  | { type: "blankLine" }
  | { type: "paragraph"; text: string }
  | { type: "sectionHeading"; text: string; marker?: string }
  | { type: "bulletList"; items: string[] }
  | { type: "numberedList"; items: Array<{ marker: string; text: string }> }
  | { type: "signatureBlock"; lines: string[] }
  | { type: "acknowledgmentBlock"; lines: string[] };

const SECTION_HEADING_PATTERN = /^(\d+)[.)]?\s+(.+)$/;
const BULLET_PATTERN = /^[*-]\s+(.+)$/;
const NUMBERED_ITEM_PATTERN = /^(\d+)[.)]\s+(.+)$/;
const SIGNATURE_START_PATTERN = /^(sincerely|regards|respectfully|best regards),?$/i;
const ACKNOWLEDGMENT_START_PATTERN = /^(acknowledged and accepted|acknowledgment|acceptance):?$/i;

function isBlank(line: string) {
  return line.trim().length === 0;
}

function isLikelySectionHeading(line: string) {
  const match = line.trim().match(SECTION_HEADING_PATTERN);
  if (!match) return null;

  const text = match[2].trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const hasSentencePunctuation = /[.!?]$/.test(text);
  const hasHeadingCase = /^[A-Z]/.test(text);

  if (wordCount <= 8 && hasHeadingCase && !hasSentencePunctuation) {
    return { marker: match[1], text };
  }

  return null;
}

function flushParagraph(lines: string[], blocks: OfferLetterPlainTextBlock[]) {
  if (lines.length === 0) return;
  blocks.push({ type: "paragraph", text: lines.join("\n").trim() });
  lines.length = 0;
}

function nextNonBlankLine(lines: string[], startIndex: number) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line) return line;
  }
  return "";
}

function startsNumberedList(lines: string[], startIndex: number) {
  const current = lines[startIndex].trim().match(NUMBERED_ITEM_PATTERN);
  if (!current) return false;
  const next = nextNonBlankLine(lines, startIndex + 1).match(NUMBERED_ITEM_PATTERN);
  if (!next) return false;
  return Number(next[1]) === Number(current[1]) + 1;
}

function consumeSignatureBlock(lines: string[], startIndex: number) {
  const signatureLines = [lines[startIndex].trim()];
  let index = startIndex + 1;

  while (index < lines.length && isBlank(lines[index])) {
    index += 1;
  }

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line || ACKNOWLEDGMENT_START_PATTERN.test(line)) break;
    signatureLines.push(line);
    index += 1;
  }

  return { block: { type: "signatureBlock", lines: signatureLines } as OfferLetterPlainTextBlock, nextIndex: index };
}

function consumeAcknowledgmentBlock(lines: string[], startIndex: number) {
  const acknowledgmentLines = [lines[startIndex].trim()];
  let index = startIndex + 1;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) break;
    acknowledgmentLines.push(line);
    index += 1;
  }

  return { block: { type: "acknowledgmentBlock", lines: acknowledgmentLines } as OfferLetterPlainTextBlock, nextIndex: index };
}

export function parseOfferLetterPlainText(input: string): OfferLetterPlainTextBlock[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const blocks: OfferLetterPlainTextBlock[] = [];
  const paragraphLines: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line) {
      flushParagraph(paragraphLines, blocks);
      if (blocks.length > 0 && blocks[blocks.length - 1].type !== "blankLine") {
        blocks.push({ type: "blankLine" });
      }
      index += 1;
      continue;
    }

    if (SIGNATURE_START_PATTERN.test(line)) {
      flushParagraph(paragraphLines, blocks);
      const result = consumeSignatureBlock(lines, index);
      blocks.push(result.block);
      index = result.nextIndex;
      continue;
    }

    if (ACKNOWLEDGMENT_START_PATTERN.test(line)) {
      flushParagraph(paragraphLines, blocks);
      const result = consumeAcknowledgmentBlock(lines, index);
      blocks.push(result.block);
      index = result.nextIndex;
      continue;
    }

    const bulletMatch = line.match(BULLET_PATTERN);
    if (bulletMatch) {
      flushParagraph(paragraphLines, blocks);
      const items: string[] = [];
      while (index < lines.length) {
        const itemMatch = lines[index].trim().match(BULLET_PATTERN);
        if (!itemMatch) break;
        items.push(itemMatch[1].trim());
        index += 1;
      }
      blocks.push({ type: "bulletList", items });
      continue;
    }

    const numberedItemMatch = line.match(NUMBERED_ITEM_PATTERN);
    if (numberedItemMatch && startsNumberedList(lines, index)) {
      flushParagraph(paragraphLines, blocks);
      const items: Array<{ marker: string; text: string }> = [];
      while (index < lines.length) {
        const itemMatch = lines[index].trim().match(NUMBERED_ITEM_PATTERN);
        if (!itemMatch) break;
        items.push({ marker: itemMatch[1], text: itemMatch[2].trim() });
        index += 1;
      }
      blocks.push({ type: "numberedList", items });
      continue;
    }

    const sectionHeading = isLikelySectionHeading(line);
    if (sectionHeading) {
      flushParagraph(paragraphLines, blocks);
      blocks.push({ type: "sectionHeading", marker: sectionHeading.marker, text: sectionHeading.text });
      index += 1;
      continue;
    }

    paragraphLines.push(rawLine.trimEnd());
    index += 1;
  }

  flushParagraph(paragraphLines, blocks);
  while (blocks[0]?.type === "blankLine") blocks.shift();
  while (blocks[blocks.length - 1]?.type === "blankLine") blocks.pop();
  return blocks;
}

export function stripLegacyOfferLetterTextHeader(input: string, options: {
  companyName?: string | null;
  workLocation?: string | null;
} = {}) {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length && isBlank(lines[index])) {
    index += 1;
  }

  const companyName = options.companyName?.trim();
  if (!companyName || lines[index]?.trim() !== companyName) {
    return input.trim();
  }

  index += 1;
  const workLocation = options.workLocation?.trim();
  if (workLocation && lines[index]?.trim() === workLocation) {
    index += 1;
  }

  while (index < lines.length && isBlank(lines[index])) {
    index += 1;
  }

  return lines.slice(index).join("\n").trim();
}
