const url = 'http://localhost:4000/api/production/plans/2026-06-05';
(async () => {
  try {
    const res = await fetch(url, { method: 'GET' });
    console.log('status', res.status);
    const text = await res.text();
    console.log(text);
  } catch (err) {
    console.error('error', err);
  }
})();
