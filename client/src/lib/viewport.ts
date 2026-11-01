/**
 * 动态视口高度：手机浏览器地址栏伸缩、微信底部栏、横竖屏切换都会改变可视高度。
 * 用 JS 写入 --app-h（px），CSS 统一用它，兼容不支持 dvh 的旧浏览器。
 */
export function installViewportHeight(): void {
  const root = document.documentElement;
  let raf = 0;
  const apply = () => {
    raf = 0;
    // 用 innerHeight（布局视口）：随地址栏伸缩变化，但不随软键盘变化，避免输入时页面乱跳
    root.style.setProperty('--app-h', `${Math.round(window.innerHeight)}px`);
    root.style.setProperty('--app-w', `${Math.round(window.innerWidth)}px`);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(apply);
  };
  apply();
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', () => {
    schedule();
    // 部分安卓机旋转后尺寸要过一会儿才稳定
    setTimeout(apply, 250);
    setTimeout(apply, 600);
  });
}
