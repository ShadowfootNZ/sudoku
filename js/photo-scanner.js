import { detectGrid, classifyBlank, assessGridQuality } from '../tools/grid-detector.js';
import { warpPerspective } from '../tools/perspective.js';
import { loadCnnRecognizer } from '../tools/cnn-recognizer.js';
import { normalizeGlyph } from '../tools/mlp-recognizer.js';

export async function scanPhoto(file, normalizedCorners = null, recognize = true) {
  if (normalizedCorners && !validCornerSelection(normalizedCorners)) {
    throw new PhotoScanError('corners', 'Keep the four corners in numbered order around the grid and spread them farther apart.');
  }
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (error) { throw new PhotoScanError('decode', 'This image could not be read. Try a JPEG or PNG copy.', error); }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const source = context.getImageData(0, 0, canvas.width, canvas.height);
  const boundary = normalizedCorners ? null : detectGrid(source);
  if (!boundary && !normalizedCorners) throw new PhotoScanError('corners', 'The grid corners need to be selected manually.');
  const corners = normalizedCorners
    ? normalizedCorners.map(point => ({ x: point.x * canvas.width, y: point.y * canvas.height }))
    : [{x:boundary.x,y:boundary.y},{x:boundary.x+boundary.width,y:boundary.y},
      {x:boundary.x+boundary.width,y:boundary.y+boundary.height},{x:boundary.x,y:boundary.y+boundary.height}];
  const cornerWidth = Math.max(Math.hypot(corners[1].x-corners[0].x,corners[1].y-corners[0].y),
    Math.hypot(corners[2].x-corners[3].x,corners[2].y-corners[3].y));
  const cornerHeight = Math.max(Math.hypot(corners[3].x-corners[0].x,corners[3].y-corners[0].y),
    Math.hypot(corners[2].x-corners[1].x,corners[2].y-corners[1].y));
  const quality = assessGridQuality(boundary || { width:cornerWidth, height:cornerHeight });
  if (quality.level === 'reject') throw new PhotoScanError('quality', quality.message);
  const details = { boundary: boundary || { method:'manual-perspective', confidence:1 }, quality,
    source: { width:canvas.width, height:canvas.height } };
  return recognize ? recognizeGrid(warpPerspective(source, corners, 900), details) : details;
}

export function validCornerSelection(corners) {
  if (!Array.isArray(corners) || corners.length !== 4) return false;
  if (corners.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)
    || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return false;
  let sign = 0;
  for (let i=0;i<4;i++) {
    const a=corners[i], b=corners[(i+1)%4], c=corners[(i+2)%4];
    const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    if (Math.abs(cross)<.001 || (sign && Math.sign(cross)!==sign)) return false;
    sign=Math.sign(cross);
  }
  const area=Math.abs(corners.reduce((sum,p,i) => {
    const next=corners[(i+1)%4]; return sum+p.x*next.y-next.x*p.y;
  },0))/2;
  return area >= .05;
}

async function recognizeGrid(gridImage, details) {
  const grid = document.createElement('canvas'); grid.width = grid.height = 900;
  grid.getContext('2d', { alpha: false }).putImageData(gridImage, 0, 0);
  const occupied = [], features = [];
  for (let row=0; row<9; row++) for (let col=0; col<9; col++) {
    const cell = document.createElement('canvas'); cell.width = cell.height = 64;
    const cx = cell.getContext('2d', { alpha:false, willReadFrequently:true });
    cx.drawImage(grid, col*100+8, row*100+8, 84, 84, 0, 0, 64, 64);
    const isOccupied = !classifyBlank(cx.getImageData(0,0,64,64)).blank;
    occupied.push(isOccupied); features.push(isOccupied ? extractFeature(cell) : null);
  }
  const indexes = occupied.map((v,i)=>v?i:-1).filter(i=>i>=0);
  const recognizer = await loadCnnRecognizer('./models/sudoku-digits-cnn-js.json');
  const output = recognizer.recognize(indexes.map(i=>features[i]));
  const digits = new Array(81).fill(0), confidence = new Array(81).fill(1);
  indexes.forEach((cell,i)=>{ digits[cell]=output.digits[i]; confidence[cell]=output.confidence[i]; });
  return { digits, confidence, reviewCells:indexes, ...details };
}

function extractFeature(source) {
  const small=document.createElement('canvas'); small.width=small.height=16;
  const cx=small.getContext('2d',{alpha:false,willReadFrequently:true}); cx.drawImage(source,0,0,16,16);
  const pixels=cx.getImageData(0,0,16,16).data, feature=new Array(256);
  for(let i=0;i<256;i++){const p=i*4; const lum=pixels[p]*.299+pixels[p+1]*.587+pixels[p+2]*.114; feature[i]=(255-lum)/255;}
  return normalizeGlyph(feature);
}

export class PhotoScanError extends Error {
  constructor(reason,message,cause){super(message,{cause});this.name='PhotoScanError';this.reason=reason;}
}
