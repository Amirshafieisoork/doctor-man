import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesFileType} from '../server/api/_lib/uploads.js';

test('declared image MIME type must match file bytes',()=>{
  const png=Buffer.from([137,80,78,71,13,10,26,10]);
  assert.equal(matchesFileType(png,'image/png'),true);
  assert.equal(matchesFileType(png,'image/jpeg'),false);
  assert.equal(matchesFileType(Buffer.from('<script>unsafe</script>'),'image/png'),false);
  assert.equal(matchesFileType(Buffer.alloc(0),'image/png'),false);
  assert.equal(matchesFileType(Buffer.from([255,216,255]),'image/jpeg'),true);
  assert.equal(matchesFileType(Buffer.from('RIFF0000WEBPdata'),'image/webp'),true);
});
test('document upload accepts PDF signature and rejects forged PDF metadata',()=>{
  assert.equal(matchesFileType(Buffer.from('%PDF-1.7\n'),'application/pdf'),true);
  assert.equal(matchesFileType(Buffer.from('not a pdf'),'application/pdf'),false);
  assert.equal(matchesFileType(Buffer.from('%PDF-1.7\n'),'image/webp'),false);
});
