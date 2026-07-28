export interface ExtractResult {
  text: string;
  pages?: Array<{ pageNumber: number; text: string }>;
  metadata: Record<string, unknown>;
}

export interface DocumentExtractorPort {
  readonly supportedMimeTypes: string[];
  extract(content: Buffer, mimeType: string): Promise<ExtractResult>;
}
