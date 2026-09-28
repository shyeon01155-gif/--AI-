const companies = [
  { key: "samsung", id: "00126380", label: "삼성전자", tone: "samsung" },
  { key: "sk", id: "00164779", label: "SK하이닉스", tone: "sk" }
];
const metrics = [
  { key: "revenue", label: "매출액" },
  { key: "cost", label: "매출원가" },
  { key: "sga", label: "판매비와관리비" },
  { key: "operating_income", label: "영업이익" }
];
const history = {};
let selectedMetric = "revenue";
const yearSelect = document.querySelector("#year");
const thisYear = new Date().getFullYear();
for (let y = thisYear - 1; y >= Math.max(thisYear - 11, 2015); y--) {
  const option = document.createElement("option"); option.value = y; option.textContent = `${y}년`; yearSelect.append(option);
}
yearSelect.value = Math.min(thisYear - 1, 2025);

const fmt = value => value == null ? "—" : new Intl.NumberFormat("ko-KR").format(value);
const eok = value => value == null ? "—" : `${(value / 100000000).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}억`;
const byCompany = (data, key) => data?.companies?.[companies.find(c => c.key === key)?.id]?.values || {};

function renderCards(data) {
  document.querySelectorAll(".metric-values").forEach(el => {
    const values = companies.map(c => ({ company: c, amount: byCompany(data, c.key)[el.dataset.metric] }));
    el.innerHTML = values.map(({company, amount}) => `<span class="metric-value">${eok(amount)}<small>${company.label}</small></span>`).join("");
  });
}
function renderTable(data) {
  document.querySelector("#tableBody").innerHTML = metrics.map(m => {
    const a = byCompany(data, "samsung")[m.key], b = byCompany(data, "sk")[m.key];
    return `<tr><td>${m.label}</td><td>${fmt(a)}</td><td>${fmt(b)}</td><td>${a == null || b == null ? "—" : fmt(a-b)}</td></tr>`;
  }).join("");
}
function renderChart() {
  const entries = Object.values(history).sort((a,b) => Number(a.year)-Number(b.year));
  const area = document.querySelector("#chartArea");
  if (!entries.length) return;
  const W=760,H=235,L=58,R=18,T=15,B=30, plotW=W-L-R, plotH=H-T-B;
  const vals = entries.flatMap(d => companies.map(c => byCompany(d,c.key)[selectedMetric]).filter(v=>v!=null));
  if (!vals.length) { area.innerHTML='<div class="loading">표시할 데이터가 없습니다.</div>'; return; }
  const max = Math.max(...vals)*1.1 || 1;
  const x = i => L + (entries.length < 2 ? plotW/2 : i*plotW/(entries.length-1));
  const y = v => T + plotH - (v/max)*plotH;
  const money = n => n >= 1e12 ? `${(n/1e12).toFixed(1)}조` : `${Math.round(n/1e8).toLocaleString("ko-KR")}억`;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${metrics.find(m=>m.key===selectedMetric).label} 연도별 비교"><defs><linearGradient id="blueFade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#4d6bee" stop-opacity=".12"/><stop offset="1" stop-color="#4d6bee" stop-opacity="0"/></linearGradient><linearGradient id="orangeFade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#e2a34a" stop-opacity=".1"/><stop offset="1" stop-color="#e2a34a" stop-opacity="0"/></linearGradient></defs>`;
  for(let i=0;i<=4;i++){const yy=T+i*plotH/4, val=max*(1-i/4);svg+=`<line class="gridline" x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}"/><text class="axis-label" x="${L-8}" y="${yy+3}" text-anchor="end">${money(val)}</text>`;}
  for(let i=0;i<entries.length;i++){svg+=`<text class="axis-label" x="${x(i)}" y="${H-7}" text-anchor="middle">${entries[i].year}</text>`;}
  for(const c of companies){const values=entries.map(d=>byCompany(d,c.key)[selectedMetric]);const pts=values.map((v,i)=>v==null?null:[x(i),y(v)]);let segments=[],segment=[];pts.forEach(p=>{if(p)segment.push(p);else if(segment.length){segments.push(segment);segment=[];}});if(segment.length)segments.push(segment);for(const s of segments){const path=s.map((p,i)=>`${i?'L':'M'}${p[0]},${p[1]}`).join(' ');if(s.length>1){svg+=`<path class="${c.key==='samsung'?'area-samsung':'area-sk'}" d="${path} L ${s[s.length-1][0]},${T+plotH} L ${s[0][0]},${T+plotH} Z"/>`;}svg+=`<path class="line-${c.key}" d="${path}"/>`;for(const p of s)svg+=`<circle class="dot-${c.key}" cx="${p[0]}" cy="${p[1]}" r="3.5"/>`;}}
  area.innerHTML=svg+'</svg>';
}
function setNotice(message="") { const el=document.querySelector("#notice");el.textContent=message;el.hidden=!message; }
async function fetchYear(year) {
  if (history[year]) return history[year];
  const response=await fetch(`/api/financials?year=${year}`);const data=await response.json();
  if(!response.ok) throw new Error(data.error||"데이터 조회에 실패했습니다.");
  history[year]=data;return data;
}
async function loadData() {
  const year=yearSelect.value, button=document.querySelector("#refresh");button.disabled=true;button.innerHTML='<span class="refresh-icon">↻</span> 조회 중';setNotice("");
  try { const years=Array.from({length:5},(_,i)=>Number(year)-4+i).filter(y=>y>=2015);const results=await Promise.allSettled(years.map(fetchYear));const data=history[year];if(!data)throw results.find(r=>r.status==="rejected")?.reason||new Error("데이터 조회에 실패했습니다.");renderCards(data);renderTable(data);document.querySelector("#footerYear").textContent=`${year}년 사업보고서`;document.querySelector("#updatedAt").textContent=`${year}년 사업보고서 · 연결 기준`;renderChart();
    const missing=metrics.some(m=>companies.some(c=>byCompany(data,c.key)[m.key]==null));if(missing)setNotice("일부 항목은 회사 공시의 계정명 차이로 값이 없을 수 있습니다. 원문 공시를 확인해 주세요.");
  } catch(error) {setNotice(error.message);document.querySelector("#chartArea").innerHTML='<div class="loading">공시 데이터를 표시할 수 없습니다.</div>';}
  finally {button.disabled=false;button.innerHTML='<span class="refresh-icon">↻</span> 데이터 조회';}
}
document.querySelectorAll("#metricTabs button").forEach(button=>button.addEventListener("click",()=>{document.querySelectorAll("#metricTabs button").forEach(b=>b.classList.remove("active"));button.classList.add("active");selectedMetric=button.dataset.metric;renderChart();}));
document.querySelector("#refresh").addEventListener("click",loadData);yearSelect.addEventListener("change",loadData);loadData();
