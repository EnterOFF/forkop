import { renderButton } from '../button/renderButton';
import { copyToClipboard } from '../../helpers/copyToClipboard';
import { downloadAsTxt } from '../../helpers/downloadAsTxt';
import { showToast } from '../../helpers/showToast';
import { E } from '../../helpers/element';

interface RenderModalOptions {
  // Asked again on every flip of the masking toggle: the router masks, so the
  // page never holds an unmasked copy nobody asked to see.
  getText?: (context: { maskValues: boolean }) => Promise<string>;
  showMaskValuesToggle?: boolean;
}

// The last flip of the masking toggle wins: a slow answer to an earlier one never replaces it, and
// a flip whose text could not be read is undone.
export function renderModal(
  text: string,
  name: string,
  options?: RenderModalOptions,
) {
  let currentText = text ?? '';
  let latestRequest = 0;

  const codeEl = E('code', {}, currentText) as HTMLElement;
  const contentEl = E(
    'pre',
    { class: 'fkp-partial-modal__content' },
    codeEl,
  ) as HTMLElement;

  const footerChildren: HTMLElement[] = [
    renderButton({
      classNames: ['cbi-button-apply'],
      text: _('Download'),
      onClick: () => downloadAsTxt(currentText, name),
    }),
    renderButton({
      classNames: ['cbi-button-apply'],
      text: _('Copy'),
      onClick: () => copyToClipboard(`\`\`\`${name}\n${currentText}\n\`\`\``),
    }),
    renderButton({
      classNames: ['cbi-button-remove'],
      text: _('Close'),
      onClick: () => ui.hideModal(),
    }),
  ];

  const getText = options?.getText;
  if (getText && options?.showMaskValuesToggle) {
    const maskValuesInput = document.createElement('input');
    maskValuesInput.type = 'checkbox';
    maskValuesInput.className = 'cbi-input-checkbox';
    maskValuesInput.checked = true;
    maskValuesInput.addEventListener('change', async () => {
      const request = ++latestRequest;
      const maskValues = maskValuesInput.checked;

      try {
        const nextText = await getText({ maskValues });
        if (request === latestRequest) {
          currentText = nextText ?? '';
          codeEl.textContent = currentText;
        }
      } catch (error) {
        console.warn('[renderModal] failed to load the text', error);
        if (request === latestRequest) {
          maskValuesInput.checked = !maskValues;
          showToast(_('Failed to load diagnostics'), 'error');
        }
      }
    });

    footerChildren.unshift(
      E('label', { class: 'fkp-partial-modal__checkbox' }, [
        maskValuesInput,
        E(
          'span',
          { class: 'fkp-partial-modal__checkbox-text' },
          _('Hide values'),
        ),
      ]) as HTMLElement,
    );
  }

  return E('div', { class: 'fkp-partial-modal__body' }, [
    E('div', {}, [
      contentEl,
      E('div', { class: 'fkp-partial-modal__footer' }, footerChildren),
    ]),
  ]) as HTMLElement;
}
