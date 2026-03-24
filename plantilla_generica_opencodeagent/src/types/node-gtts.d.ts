declare module 'node-gtts' {
  import { Readable } from 'stream';
  function gtts(text: string, lang?: string): Readable;
  export = gtts;
}
