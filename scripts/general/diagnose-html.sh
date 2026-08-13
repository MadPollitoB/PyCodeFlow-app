#!/bin/bash
# Toont de exacte syntaxfout + regelnummer in een HTML inline-script.
# Gebruik: bash diagnose-html.sh web/public/quiz-student.html
FILE="${1:-web/public/quiz-student.html}"
node -e "
const fs=require('fs'),vm=require('vm');
const c=fs.readFileSync('$FILE','utf8');
const re=/<script>\s*\n([\s\S]*?)<\/script>/g;let m,found=false;
while((m=re.exec(c))!==null){
  const startLine=c.slice(0,m.index).split('\n').length;
  try{new vm.Script(m[1]);}catch(e){
    found=true;
    const lm=(e.stack||'').match(/:(\d+)\)?\n/);
    const fileLine=lm?startLine+parseInt(lm[1]):null;
    console.log('❌ $FILE');
    console.log('   Fout:', e.message);
    if(fileLine) console.log('   Rond bestandsregel:', fileLine);
    if(fileLine){
      const lines=c.split('\n');
      for(let i=Math.max(0,fileLine-3);i<Math.min(lines.length,fileLine+2);i++)
        console.log('   '+(i+1)+': '+lines[i]);
    }
  }
}
if(!found) console.log('✅ $FILE — geen syntaxfout');
"
