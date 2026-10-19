export function waterTexture():ImageData{
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
  const context=canvas.getContext('2d')!;
  context.fillStyle='#69afcf';context.fillRect(0,0,64,64);
  const points=Array.from({length:5},(_,row)=>Array.from({length:5},(_,column)=>[column*16+(column>0&&column<4?Math.sin(row*7+column*3)*5:0),row*16+(row>0&&row<4?Math.cos(column*5+row*2)*5:0)]));
  const shades=['#79b9d4','#64a8c7','#70b2ce','#5fa4c4','#80bcd5'];
  for(let row=0;row<4;row++)for(let column=0;column<4;column++){
    const first=points[row][column],second=points[row][column+1],third=points[row+1][column],fourth=points[row+1][column+1];
    for(const [index,triangle] of [[first,second,third],[second,fourth,third]].entries()){
      context.fillStyle=shades[(row*7+column*3+index*2)%shades.length];
      context.beginPath();context.moveTo(triangle[0][0],triangle[0][1]);context.lineTo(triangle[1][0],triangle[1][1]);context.lineTo(triangle[2][0],triangle[2][1]);context.closePath();context.fill();
    }
  }
  return context.getImageData(0,0,64,64);
}
