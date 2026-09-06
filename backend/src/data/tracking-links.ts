// 配布済みURLの流入定義。リンク先はアプリ内のパスに限定する。
export const trackingLinks = [
  { code: 'note-cost', to: '/', source: 'note', medium: 'article', campaign: 'airshift-cost' },
  { code: 'note-switch', to: '/', source: 'note', medium: 'article', campaign: 'airshift-switch' },
  { code: 'note-diy', to: '/', source: 'note', medium: 'article', campaign: 'shiftlog-diy' },
  { code: 'x-profile', to: '/', source: 'x', medium: 'profile', campaign: 'shiba' },
  { code: 'x-post', to: '/', source: 'x', medium: 'post', campaign: 'shiftlog' },
  { code: 'threads-profile', to: '/', source: 'threads', medium: 'profile', campaign: 'shiba' },
  { code: 'threads-post', to: '/', source: 'threads', medium: 'post', campaign: 'shiftlog' },
  { code: 'itreview', to: '/', source: 'itreview', medium: 'listing', campaign: 'shiftlog' },
  { code: 'kojindev', to: '/', source: 'kojindev', medium: 'listing', campaign: 'shiftlog' },
  { code: 'lp', to: '/', source: 'lp', medium: 'link', campaign: 'shiftlog' },
];
