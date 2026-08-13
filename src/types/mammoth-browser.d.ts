declare module "mammoth/mammoth.browser.js" {
  interface MammothRawTextResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  const mammoth: {
    extractRawText(input: {
      arrayBuffer: ArrayBuffer;
    }): Promise<MammothRawTextResult>;
  };
  export default mammoth;
}
