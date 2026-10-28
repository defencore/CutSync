import { describe, it, expect } from 'vitest';
import { timecode } from '../src/types';
describe('frame timecode',()=>{
 it('avoids floating-point frame loss at decimal boundaries',()=>{expect(timecode(1.2,25)).toBe('00:00:01:05');expect(timecode(12.04,25)).toBe('00:00:12:01');});
 it('formats hour boundaries and clamps negative time',()=>{expect(timecode(3661.4,25)).toBe('01:01:01:10');expect(timecode(-1)).toBe('00:00:00:00');});
});
