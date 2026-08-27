(function () {
  const phoneSelector = 'input[type="tel"]';

  function phoneDigits(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 10);
  }

  function formatPhone(value) {
    const digits = phoneDigits(value);
    if (!digits) return '';
    if (digits.length < 4) return `(${digits}`;
    if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  function preparePhoneInput(input) {
    if (!(input instanceof HTMLInputElement) || !input.matches(phoneSelector)) return;
    input.inputMode = 'numeric';
    input.autocomplete = input.autocomplete || 'tel-national';
    input.maxLength = 14;
    input.placeholder = input.placeholder || '(555) 555-5555';
    input.value = formatPhone(input.value);
  }

  document.addEventListener('input', function (event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches(phoneSelector)) return;
    const formatted = formatPhone(input.value);
    if (input.value !== formatted) input.value = formatted;
  }, true);

  function prepareAll(root) {
    if (root instanceof HTMLInputElement) preparePhoneInput(root);
    if (root.querySelectorAll) root.querySelectorAll(phoneSelector).forEach(preparePhoneInput);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { prepareAll(document); });
  } else {
    prepareAll(document);
  }

  new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      mutation.addedNodes.forEach(function (node) {
        if (node.nodeType === Node.ELEMENT_NODE) prepareAll(node);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
