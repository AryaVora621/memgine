/**
 * A simplified context compressor inspired by Headroom (Content-Compressed Retrieval).
 * In a real implementation, this would use AST parsing for code and a specialized 
 * model (like Kompress-base) for text to reduce tokens by 60-95%.
 */

export function compressContext(content: string, type: 'code' | 'text' | 'json'): string {
  if (!content) return '';
  
  switch (type) {
    case 'code':
      // Simulated AST compression: Strip comments, empty lines, and condense whitespace
      return content
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '') // Remove comments
        .replace(/^\s*[\r\n]/gm, '') // Remove empty lines
        .replace(/\s{2,}/g, ' ') // Condense spaces
        .trim();
        
    case 'json':
      // SmartCrusher simulation: Minify JSON and truncate large arrays
      try {
        const parsed = JSON.parse(content);
        // Truncate arrays larger than 5 items
        const truncateArrays = (obj: any): any => {
          if (Array.isArray(obj)) {
            if (obj.length > 5) {
              return [...obj.slice(0, 5), `... ${obj.length - 5} more items`];
            }
            return obj.map(truncateArrays);
          } else if (obj !== null && typeof obj === 'object') {
            const newObj: any = {};
            for (const key in obj) {
              newObj[key] = truncateArrays(obj[key]);
            }
            return newObj;
          }
          return obj;
        };
        return JSON.stringify(truncateArrays(parsed));
      } catch (e) {
        return content;
      }
      
    case 'text':
    default:
      // Sliding window or semantic chunking (simulation: just truncate middle if too long)
      const MAX_LENGTH = 1000;
      if (content.length > MAX_LENGTH) {
        const half = Math.floor(MAX_LENGTH / 2);
        return content.substring(0, half) + '\n...[COMPRESSED]...\n' + content.substring(content.length - half);
      }
      return content;
  }
}
