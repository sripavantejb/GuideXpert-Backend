function to10Digits(val) {
  if (val == null) return '';
  return String(val).replace(/\D/g, '').trim().slice(-10).slice(0, 10);
}

module.exports = { to10Digits };
