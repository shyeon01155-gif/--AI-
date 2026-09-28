import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.md':'text/markdown; charset=utf-8' };
const financialCache = new Map();
const requestCounts = new Map();

async function apiKey() {
  if (process.env.OPENDART_API_KEY?.trim()) return process.env.OPENDART_API_KEY.trim();
  try {
    const env = await readFile(join(root, '.env.txt'), 'utf8');
    return env.match(/^\s*OPENDART_API_KEY\s*=\s*(.*?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '') ?? '';
  } catch { return ''; }
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'Content-Length':Buffer.byteLength(body) });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8000');
  if (url.pathname === '/api/status') return json(res, 200, { configured: Boolean(await apiKey()) });
  if (url.pathname === '/api/financials') {
    const key = await apiKey();
    const year = url.searchParams.get('year') || '';
    if (!key) return json(res, 400, { error: 'OPENDART_API_KEY를 .env.txt에 설정해 주세요.' });
    const yearNumber = Number(year);
    if (!/^20\d{2}$/.test(year) || yearNumber < 2015 || yearNumber > new Date().getFullYear() - 1) return json(res, 400, { error: '2015년부터 최신 사업보고서 연도까지 조회할 수 있습니다.' });
    const now = Date.now();
    const ip = req.socket.remoteAddress || 'unknown';
    const window = requestCounts.get(ip);
    if (window && now - window.started < 60_000 && window.count >= 30) return json(res, 429, { error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' });
    if (!window || now - window.started >= 60_000) requestCounts.set(ip, { started:now, count:1 });
    else window.count++;
    const cached = financialCache.get(year);
    if (cached && now - cached.saved < 6 * 60 * 60 * 1000) return json(res, 200, cached.data);
    const companies = { '00126380':{ name:'삼성전자', stock_code:'005930' }, '00164779':{ name:'SK하이닉스', stock_code:'000660' } };
    const accounts = {
      revenue:{ ids:['ifrs-full_Revenue','ifrs_Revenue'], names:['매출액','수익(매출액)','영업수익'] },
      cost:{ ids:['ifrs-full_CostOfSales','ifrs_CostOfSales'], names:['매출원가'] },
      sga:{ ids:['ifrs-full_SellingGeneralAndAdministrativeExpense','ifrs_SellingGeneralAndAdministrativeExpense','dart_TotalSellingGeneralAdministrativeExpenses'], names:['판매비와관리비','판매비와 관리비'] },
      operating_income:{ ids:['ifrs-full_ProfitLossFromOperatingActivities','ifrs_ProfitLossFromOperatingActivities','dart_OperatingIncomeLoss'], names:['영업이익','영업이익(손실)'] },
    };
    let payloads;
    try {
      payloads = await Promise.all(Object.entries(companies).map(async ([code]) => {
        const params = new URLSearchParams({ crtfc_key:key, corp_code:code, bsns_year:year, reprt_code:'11011', fs_div:'CFS' });
        const response = await fetch(`https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?${params}`);
        return [code, await response.json()];
      }));
    } catch (error) { return json(res, 502, { error:`OpenDART에 연결하지 못했습니다: ${error.cause?.code || error.message}` }); }
    const failed = payloads.find(([, payload]) => payload.status !== '000');
    if (failed) return json(res, 502, { error:failed[1].message || 'OpenDART 조회에 실패했습니다.', status:failed[1].status });
    const result = Object.fromEntries(Object.entries(companies).map(([code, company]) => {
      const payload = Object.fromEntries(payloads)[code];
      let rows = payload.list.filter(row => row.sj_div === 'IS');
      if (!rows.length) rows = payload.list.filter(row => row.sj_div === 'CIS');
      const values = Object.fromEntries(Object.entries(accounts).map(([metric, account]) => {
        const row = rows.find(item => account.ids.includes(item.account_id)) || rows.find(item => account.names.includes(item.account_nm?.trim()));
        const amount = row?.thstrm_amount && row.thstrm_amount !== '-' ? row.thstrm_amount : row?.thstrm_add_amount;
        const value = Number(String(amount ?? '').replaceAll(',', ''));
        return [metric, row && Number.isFinite(value) ? value : null];
      }));
      return [code, { ...company, values }];
    }));
    const data = { year, basis:'연결', report:'사업보고서', companies:result, source:'OpenDART' };
    financialCache.set(year, { saved:now, data });
    return json(res, 200, data);
  }
  const requestPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = normalize(join(root, requestPath));
  if (!file.startsWith(root) || !existsSync(file)) return json(res, 404, { error:'파일을 찾을 수 없습니다.' });
  try { const body = await readFile(file); res.writeHead(200, { 'Content-Type':mime[extname(file)] || 'application/octet-stream', 'Content-Length':body.length }); res.end(body); }
  catch { json(res, 404, { error:'파일을 찾을 수 없습니다.' }); }
});

const port = Number(process.env.PORT || 8000);
const host = process.env.PORT ? '0.0.0.0' : '127.0.0.1';
server.listen(port, host, () => console.log(`비교 사이트 실행 중: http://${host}:${port}`));
