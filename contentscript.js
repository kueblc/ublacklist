const _ = s => chrome.i18n.getMessage(s);

class UBlacklist {
  constructor() {
    this.blockRules = null;
    this.blockedSiteCount = 0;
    this.queuedSites = [];
    this.styleSheetsLoaded = false;

    chrome.storage.local.get({ blacklist: '' }, options => {
      this.onBlacklistLoaded(options.blacklist);
    });

    new MutationObserver(records => {
      this.onDOMContentMutated(records);
    }).observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener('DOMContentLoaded', () => {
      this.onDOMContentLoaded();
    });
  }

  onBlacklistLoaded(blacklist) {
    this.blockRules = [];
    if (blacklist) {
      for (const raw of blacklist.split(/\n/)) {
        const compiled = UBlacklist.compileBlockRule(raw);
        this.blockRules.push({ raw, compiled });
      }
    }
    for (const site of this.queuedSites) {
      this.judgeSite(site);
    }
    this.queuedSites = [];
  }

  onDOMContentMutated(records) {
    if (!this.styleSheetsLoaded && document.head) {
      this.setupStyleSheets();
      this.styleSheetsLoaded = true;
    }
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.matches && node.matches('.g') && !node.matches('.g .g')) {
          this.setupBlockLinks(node);
          if (this.blockRules) {
            this.judgeSite(node);
          } else {
            this.queuedSites.push(node);
          }
        }
      }
    }
    this.updateControl();
  }

  onDOMContentLoaded() {
    this.setupControl();
    this.setupBlockDialogs();
  }

  setupStyleSheets() {
    const hideStyle = document.createElement('style');
    document.head.appendChild(hideStyle);
    hideStyle.sheet.insertRule('#uBlacklistHideLink { display: none; }');
    hideStyle.sheet.insertRule('.uBlacklistBlocked { display: none; }');
    hideStyle.sheet.insertRule('.uBlacklistUnblockLink { display: none; }');

    const showStyle = document.createElement('style');
    showStyle.id = 'uBlacklistShowStyle';
    document.head.appendChild(showStyle);
    showStyle.sheet.insertRule('#uBlacklistShowLink { display: none; }');
    showStyle.sheet.insertRule('#uBlacklistHideLink { display: inline; }');
    showStyle.sheet.insertRule('.uBlacklistBlocked { background-color: #ffe0e0; display: block; }');
    showStyle.sheet.insertRule('.uBlacklistBlocked .uBlacklistBlockLink { display: none; }');
    showStyle.sheet.insertRule('.uBlacklistBlocked .uBlacklistUnblockLink { display: inline; }');

    showStyle.sheet.disabled = true;
  }

  setupBlockLinks(site) {
    // I have found 2 patterns of DOM tree (Sep 30, 2018).
    // -------------------------------------------------------------------------
    // div.g
    //  |-div
    //     |-div.rc
    //        |-h3.r
    //           |-a                   <- site link
    //        |-div.s
    //           |-div *
    //           |-div
    //              |-div.f
    //                 |-cite
    //                 |-div *
    //                 |-              <- where to add block/unblock links
    //              |-div.slp.f *
    //              |-span.st
    //              |-div.osl *
    //              |-div *
    //           |-div *
    //        |-div
    // -------------------------------------------------------------------------
    // div.g
    //  |-div
    //     |-div.rc
    //        |-div.r
    //           |-a                   <- site link
    //              |-h3
    //              |-br
    //              |-div
    //                 |-cite
    //           |-span *
    //           |-a.fl *
    //           |-                    <- where to add block/unblock links
    //        |-div.s
    //           |-div *
    //           |-div
    //              |-div.slp.f *
    //              |-span.st
    //                 |-span.f
    //              |-div.osl *
    //              |-div *
    //           |-div *
    //        |-div
    // -------------------------------------------------------------------------
    // * optional
    const siteLink = site.querySelector('a');
    const blockLinksParent = site.querySelector('div.r') || site.querySelector('div.f');
    if (siteLink && blockLinksParent) {
      const blockLink = document.createElement('a');
      blockLink.className = 'fl uBlacklistBlockLink';
      blockLink.href = 'javascript:void(0)';
      blockLink.textContent = _('blockThisSite');
      blockLink.addEventListener('click', () => {
        if (this.blockRules) {
          document.getElementById('uBlacklistBlockInput').value = new URL(siteLink.href).origin + '/*';
          document.getElementById('uBlacklistBlockDialog').showModal();
        }
      });

      const unblockLink = document.createElement('a');
      unblockLink.className = 'fl uBlacklistUnblockLink';
      unblockLink.href = 'javascript:void(0)';
      unblockLink.textContent = _('unblockThisSite');
      unblockLink.addEventListener('click', () => {
        if (this.blockRules) {
          const unblockSelect = document.getElementById('uBlacklistUnblockSelect');
          while (unblockSelect.firstChild) {
            unblockSelect.removeChild(unblockSelect.firstChild);
          }
          this.blockRules.forEach((rule, index) => {
            if (rule.compiled && rule.compiled.test(siteLink.href)) {
              const option = document.createElement('option');
              option.textContent = rule.raw;
              option.value = String(index);
              unblockSelect.appendChild(option);
            }
          });
          document.getElementById('uBlacklistUnblockDialog').showModal();
        }
      });

      blockLinksParent.appendChild(document.createTextNode('\u00a0'));
      blockLinksParent.appendChild(blockLink);
      blockLinksParent.appendChild(unblockLink);
    }
  }

  setupControl() {
    const resultStats = document.getElementById('resultStats');
    if (resultStats) {
      const stats = document.createElement('span');
      stats.id = 'uBlacklistStats';

      const showLink = document.createElement('a');
      showLink.id = 'uBlacklistShowLink';
      showLink.href = 'javascript:void(0)';
      showLink.textContent = _('show');
      showLink.addEventListener('click', () => {
        document.getElementById('uBlacklistShowStyle').sheet.disabled = false;
      });

      const hideLink = document.createElement('a');
      hideLink.id = 'uBlacklistHideLink';
      hideLink.href = 'javascript:void(0)';
      hideLink.textContent = _('hide');
      hideLink.addEventListener('click', () => {
        document.getElementById('uBlacklistShowStyle').sheet.disabled = true;
      });

      const control = document.createElement('span');
      control.id = 'uBlacklistControl';
      control.appendChild(stats);
      control.appendChild(document.createTextNode('\u00a0'));
      control.appendChild(showLink);
      control.appendChild(hideLink);

      resultStats.appendChild(control);

      this.updateControl();
    }
  }

  setupBlockDialogs() {
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="uBlacklistBlockDialog" style="padding:0">
        <form id="uBlacklistBlockForm" style="padding:1em">
          <label>
            ${_('blockThisSite')}:
            <input id="uBlacklistBlockInput" type="text" size="40" spellcheck="false" style="margin:0.5em">
          </label>
          <button type="submit">${_('ok')}</button>
        </form>
      </dialog>
      <dialog id="uBlacklistUnblockDialog" style="padding:0">
        <form id="uBlacklistUnblockForm" style="padding:1em">
          <label>
            ${_('unblockThisSite')}:
            <select id="uBlacklistUnblockSelect" style="margin:0.5em;width:20em">
            </select>
          </label>
          <button type="submit">${_('ok')}</button>
        </form>
      </dialog>
    `);

    const blockDialog = document.getElementById('uBlacklistBlockDialog');
    document.getElementById('uBlacklistBlockForm').addEventListener('submit', event => {
      event.preventDefault();
      const raw = document.getElementById('uBlacklistBlockInput').value;
      const compiled = UBlacklist.compileBlockRule(raw);
      if (compiled) {
        this.blockRules.push({ raw, compiled });
        this.rejudgeAllSites();
        this.saveBlacklist();
      }
      blockDialog.close();
    });
    blockDialog.addEventListener('click', event => {
      if (event.target == blockDialog) {
        blockDialog.close();
      }
    });

    const unblockDialog = document.getElementById('uBlacklistUnblockDialog');
    document.getElementById('uBlacklistUnblockForm').addEventListener('submit', event => {
      event.preventDefault();
      this.blockRules.splice(Number(document.getElementById('uBlacklistUnblockSelect').value), 1);
      this.rejudgeAllSites();
      this.saveBlacklist();
      unblockDialog.close();
    });
    unblockDialog.addEventListener('click', event => {
      if (event.target == unblockDialog) {
        unblockDialog.close();
      }
    });
  }

  judgeSite(site) {
    const siteLink = site.querySelector('a');
    if (siteLink && this.blockRules.some(rule => rule.compiled && rule.compiled.test(siteLink.href))) {
      site.classList.add('uBlacklistBlocked');
      ++this.blockedSiteCount;
    }
  }

  rejudgeAllSites() {
    this.blockedSiteCount = 0;
    for (const site of document.querySelectorAll('.g')) {
      if (site.matches('.g .g')) { continue; }
      site.classList.remove('uBlacklistBlocked');
      this.judgeSite(site);
    }
    this.updateControl();
  }

  saveBlacklist() {
    chrome.storage.local.set({ blacklist: this.blockRules.map(rule => rule.raw).join('\n') });
  }

  updateControl() {
    const control = document.getElementById('uBlacklistControl');
    if (control) {
      if (this.blockedSiteCount) {
        const stats = document.getElementById('uBlacklistStats');
        stats.textContent = _('nSitesBlocked').replace('%d', String(this.blockedSiteCount));
        control.style.display = 'inline';
      } else {
        control.style.display = 'none';
        document.getElementById('uBlacklistShowStyle').sheet.disabled = true;
      }
    }
  }

  static compileBlockRule(raw) {
    raw = raw.trim();
    const mp = raw.match(/^(\*|http|https|ftp):\/\/(?:(\*)|(\*\.)?([^\/*]+))(\/.*)$/);
    if (mp) {
      const escapeRegExp = s => s.replace(/[$^\\.*+?()[\]{}|]/g, '\\$&');
      return new RegExp(
        '^' +
        (mp[1] == '*' ? '(http|https)' : mp[1]) +
        '://' +
        (mp[2] ? '[^/]+' : (mp[3] ? '([^/]+\\.)?' : '') + escapeRegExp(mp[4])) +
        escapeRegExp(mp[5]).replace(/\\\*/g, '.*') +
        '$'
      );
    }
    const re = raw.match(/^\/((?:[^*\\/[]|\\.|\[(?:[^\]\\]|\\.)*\])(?:[^\\/[]|\\.|\[(?:[^\]\\]|\\.)*\])*)\/(.*)$/);
    if (re) {
      try {
        const compiled = new RegExp(re[1], re[2]);
        return compiled.global ? new RegExp(re[1], re[2].replace('g', '')) : compiled;
      } catch (e) {
        console.warn('uBlacklist: invalid regular expression: ' + raw);
        return null;
      }
    }
    return null;
  }
}

new UBlacklist();