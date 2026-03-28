import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { COLORS } from '../theme';

const fmtMoney = (n) => '₦' + Number(n || 0).toLocaleString();
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getLast12Months() {
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth(), label: `${MONTH_NAMES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` });
  }
  return months;
}

function GlowCard({ icon, value, label, sub, accent }) {
  return (
    <div style={{
      background: accent ? `linear-gradient(135deg, ${COLORS.primaryDark}, ${COLORS.primary})` : '#fff',
      borderRadius: '14px',
      padding: '20px',
      border: `1px solid ${accent ? 'transparent' : COLORS.border}`,
      color: accent ? '#fff' : COLORS.text,
      boxShadow: accent ? '0 8px 24px rgba(26,95,42,0.25)' : 'none',
    }}>
      <div style={{ fontSize: '26px', lineHeight: 1, marginBottom: '8px' }}>{icon}</div>
      <div style={{ fontSize: '22px', fontWeight: 800, lineHeight: 1.1, color: accent ? '#fff' : COLORS.primary, wordBreak: 'break-word' }}>{value}</div>
      <div style={{ fontSize: '12px', fontWeight: 600, marginTop: '6px', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      {sub && <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.7 }}>{sub}</div>}
    </div>
  );
}

export default function FinancialSummary({ currentUser, capital, distributions, isMobile }) {
  const months = getLast12Months();
  const now = new Date();
  const curMonth = now.getMonth();
  const curYear = now.getFullYear();

  // My capital entries (by user_id OR name match)
  const myCapital = useMemo(() =>
    capital.filter(c => c.user_id === currentUser.id || c.name === currentUser.name),
    [capital, currentUser]
  );

  // All capital (for share calculation)
  const totalAllCapital = capital.reduce((s, c) => s + (c.amount || 0), 0);
  const myTotalCapital = myCapital.reduce((s, c) => s + (c.amount || 0), 0);
  const sharePercent = totalAllCapital > 0 ? ((myTotalCapital / totalAllCapital) * 100).toFixed(1) : '0.0';

  // My distributions (by stakeholder_name)
  const myDists = useMemo(() =>
    distributions.filter(d =>
      d.stakeholder_name === currentUser.name ||
      d.created_by === currentUser.id ||
      d.created_by === currentUser.username
    ),
    [distributions, currentUser]
  );

  const totalProfit = myDists.reduce((s, d) => s + (d.amount || 0), 0);

  const thisMonthDists = myDists.filter(d => {
    const dt = new Date(d.date || d.created_at || '');
    return dt.getMonth() === curMonth && dt.getFullYear() === curYear;
  });
  const thisMonthProfit = thisMonthDists.reduce((s, d) => s + (d.amount || 0), 0);

  const prevMonth = curMonth === 0 ? 11 : curMonth - 1;
  const prevYear = curMonth === 0 ? curYear - 1 : curYear;
  const lastMonthDists = myDists.filter(d => {
    const dt = new Date(d.date || d.created_at || '');
    return dt.getMonth() === prevMonth && dt.getFullYear() === prevYear;
  });
  const lastMonthProfit = lastMonthDists.reduce((s, d) => s + (d.amount || 0), 0);

  // Last withdrawal info
  const sortedDists = [...myDists].sort((a, b) => new Date(b.date || b.created_at) - new Date(a.date || a.created_at));
  const lastWithdrawal = sortedDists[0];

  // Monthly profit chart
  const profitChartData = months.map(({ year, month, label }) => {
    const val = myDists.filter(d => {
      const dt = new Date(d.date || d.created_at || '');
      return dt.getMonth() === month && dt.getFullYear() === year;
    }).reduce((s, d) => s + (d.amount || 0), 0);
    return { month: label, profit: val };
  });

  // Capital share pie
  const sharePie = [
    { name: 'Your share', value: myTotalCapital },
    { name: 'Others', value: Math.max(0, totalAllCapital - myTotalCapital) },
  ];
  const PIE_COLORS = [COLORS.primary, COLORS.border];

  // Capital growth since joined
  const firstCapital = myCapital.length > 0
    ? [...myCapital].sort((a, b) => new Date(a.date) - new Date(b.date))[0]
    : null;
  const growthPct = firstCapital && firstCapital.amount > 0
    ? (((myTotalCapital - firstCapital.amount) / firstCapital.amount) * 100).toFixed(1)
    : null;

  return (
    <div style={{ background: '#fff', borderRadius: '12px', border: `1px solid ${COLORS.border}`, marginBottom: '20px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: isMobile ? '16px' : '20px 24px', borderBottom: `1px solid ${COLORS.border}`, background: `linear-gradient(90deg, ${COLORS.accentLight}, #fff)` }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: '8px' }}>
          💎 Your Financial Summary
        </h3>
        <div style={{ fontSize: '13px', color: COLORS.textMuted, marginTop: '4px' }}>
          Your share of the business, earnings, and withdrawals — in plain numbers
        </div>
      </div>

      <div style={{ padding: isMobile ? '16px' : '20px 24px' }}>
        {/* At-a-glance hero cards */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginBottom: '24px' }}>
          <GlowCard accent icon="🏦" value={fmtMoney(myTotalCapital)} label="Capital you've invested" sub="Total amount you've put into the business" />
          <GlowCard icon="🎉" value={fmtMoney(totalProfit)} label="Total profit earned" sub="All profits distributed to you so far" />
          <GlowCard icon="📅" value={fmtMoney(thisMonthProfit)} label="This month's profit" sub={`Last month: ${fmtMoney(lastMonthProfit)}`} />
          <GlowCard icon="💸" value={fmtMoney(sortedDists.reduce((s, d) => s + (d.amount || 0), 0))} label="Total withdrawn" sub={lastWithdrawal ? `Last: ${fmtMoney(lastWithdrawal.amount)} on ${new Date(lastWithdrawal.date || lastWithdrawal.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'No withdrawals yet'} />
        </div>

        {/* Capital share + pie */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
          {/* Your share of the business */}
          <div style={{ background: COLORS.bg, borderRadius: '12px', padding: '20px', textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '12px', color: COLORS.primaryDark }}>
              Your Share of the Business
            </div>
            <div style={{ position: 'relative', height: '140px' }}>
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={sharePie} cx="50%" cy="50%" innerRadius={46} outerRadius={62} startAngle={90} endAngle={-270} dataKey="value" stroke="none">
                    {sharePie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 800, color: COLORS.primary }}>{sharePercent}%</div>
                <div style={{ fontSize: '10px', color: COLORS.textMuted, fontWeight: 600 }}>your share</div>
              </div>
            </div>
            <div style={{ fontSize: '13px', color: COLORS.text, fontWeight: 600 }}>
              You own {sharePercent}% of the business
            </div>
            <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '4px' }}>
              {fmtMoney(myTotalCapital)} of {fmtMoney(totalAllCapital)} total capital
            </div>
          </div>

          {/* Capital info */}
          <div style={{ background: COLORS.bg, borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontWeight: 700, fontSize: '14px', color: COLORS.primaryDark }}>Capital Overview</div>

            <div>
              <div style={{ fontSize: '12px', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Capital Invested</div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primary }}>{fmtMoney(myTotalCapital)}</div>
            </div>

            {growthPct !== null && (
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: Number(growthPct) >= 0 ? COLORS.primaryLight : COLORS.dangerLight, border: `1px solid ${Number(growthPct) >= 0 ? '#b7e4c7' : '#f5c6cb'}` }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: Number(growthPct) >= 0 ? COLORS.primary : COLORS.danger }}>
                  {Number(growthPct) >= 0 ? '📈' : '📉'} Your capital has {Number(growthPct) >= 0 ? 'grown' : 'changed'} {growthPct}% since you joined
                </div>
              </div>
            )}

            <div>
              <div style={{ fontSize: '12px', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Contributions ({myCapital.length})</div>
              <div style={{ maxHeight: '80px', overflowY: 'auto' }}>
                {myCapital.slice(0, 5).map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '4px 0', borderBottom: `1px solid ${COLORS.border}` }}>
                    <span style={{ color: COLORS.textMuted }}>{new Date(c.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    <span style={{ fontWeight: 700, color: COLORS.primary }}>{fmtMoney(c.amount)}</span>
                  </div>
                ))}
                {myCapital.length === 0 && <div style={{ fontSize: '13px', color: COLORS.textMuted, fontStyle: 'italic' }}>No capital entries found</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Earnings over time chart */}
        <div style={{ background: COLORS.bg, borderRadius: '12px', padding: isMobile ? '14px' : '20px' }}>
          <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '16px', color: COLORS.primaryDark }}>
            📈 Your Earnings Over Time
          </div>
          {profitChartData.some(d => d.profit > 0) ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={profitChartData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={v => `₦${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => [fmtMoney(v), 'Profit Received']} />
                <Line type="monotone" dataKey="profit" stroke={COLORS.primary} strokeWidth={3} dot={{ fill: COLORS.primary, r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: COLORS.textMuted }}>
              <div style={{ fontSize: '36px', marginBottom: '10px' }}>💰</div>
              <div style={{ fontWeight: 700, marginBottom: '4px', color: COLORS.text }}>No earnings recorded yet</div>
              <div style={{ fontSize: '13px' }}>Your profit distributions will appear here once recorded.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
