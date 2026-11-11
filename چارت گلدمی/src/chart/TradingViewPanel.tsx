/**
 * ویجت تریدینگ‌ویو — اونس جهانی طلا به دلار.
 *
 * فقط برای نمای بازار جهانی است و هیچ ربطی به قیمتی که کاربر با آن معامله
 * می‌کند ندارد؛ آن چارت، MazneChart است.
 */
export function TradingViewPanel() {
  return (
    <iframe title="TradingView Chart" style={{ width: '100%', height: '100%', border: 'none' }}
      src="https://s.tradingview.com/widgetembed/?frameElementId=tradingview&symbol=OANDA:XAUUSD&interval=15&theme=dark&style=1&locale=fa_IR&toolbar_bg=%23131722&enable_publishing=false&hide_top_toolbar=false&hide_side_toolbar=false&allow_symbol_change=false&details=true"
      allowFullScreen />
  );
}

