// ── Safe localStorage helpers (private to this module) ──
var _lsGet = function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } };
var _lsSet = function(k,v){ try{ localStorage.setItem(k,v); }catch(e){} };
var _lsRemove = function(k){ try{ localStorage.removeItem(k); }catch(e){} };
    // ══════════════════════════════════════════════════════════
    //  USER PROFILE PAGE
    //  Reference: partner profile page (image provided)
    //  Sections: Primary Details, Address Details, Bank Details
    //  Edit permission: Admin, Accounts, Login Team (Operations)
    //  Partner users also see their DSA / partner metadata row
    // ══════════════════════════════════════════════════════════

    // Extended profile data per user (keyed by email)
    window.USER_PROFILES = window.USER_PROFILES || {
      'admin@efin.com': {
        firstName: 'Admin', middleName: '', lastName: 'User',
        gender: 'M', mobile: '9900000001', email: 'admin@efin.com',
        dob: '1985-06-15', employeeId: 'EMP-ADM-001',
        // Address
        addressLine1: 'EFIN Head Office, 4th Floor', addressLine2: 'BKC, Bandra East',
        postalCode: '400051', city: 'Mumbai', state: 'Maharashtra',
        // Bank
        accountHolderName: 'EFIN Finance Pvt Ltd', bankName: 'HDFC Bank',
        accountType: 'Current', accountNumber: '50200012345678', ifscCode: 'HDFC0000001',
        // Partner meta (for partners)
        businessHead: '—', partnerName: '—', partnerCode: '—',
        rm: '—', rmMobile: '—', supervisor: '—', supervisorMobile: '—',
        photoData: null,
      },
      'login@efin.com': {
        firstName: 'Login', middleName: '', lastName: 'Officer',
        gender: 'M', mobile: '9900000002', email: 'login@efin.com',
        dob: '1990-03-22', employeeId: 'EMP-LGN-002',
        addressLine1: '', addressLine2: '', postalCode: '', city: '', state: '',
        accountHolderName: '', bankName: '', accountType: 'Savings', accountNumber: '', ifscCode: '',
        businessHead: '—', partnerName: '—', partnerCode: '—',
        rm: '—', rmMobile: '—', supervisor: '—', supervisorMobile: '—',
        photoData: null,
      },
      'tl@efin.com': {
        firstName: 'Team', middleName: '', lastName: 'Lead',
        gender: 'M', mobile: '9900000003', email: 'tl@efin.com',
        dob: '1988-11-10', employeeId: 'EMP-TL-003',
        addressLine1: '', addressLine2: '', postalCode: '', city: '', state: '',
        accountHolderName: '', bankName: '', accountType: 'Savings', accountNumber: '', ifscCode: '',
        businessHead: '—', partnerName: '—', partnerCode: '—',
        rm: '—', rmMobile: '—', supervisor: '—', supervisorMobile: '—',
        photoData: null,
      },
      'sales@efin.com': {
        firstName: 'Sales', middleName: '', lastName: 'Exec',
        gender: 'M', mobile: '9900000004', email: 'sales@efin.com',
        dob: '1995-07-04', employeeId: 'EMP-SLS-004',
        addressLine1: '', addressLine2: '', postalCode: '', city: '', state: '',
        accountHolderName: '', bankName: '', accountType: 'Savings', accountNumber: '', ifscCode: '',
        businessHead: '—', partnerName: '—', partnerCode: '—',
        rm: '—', rmMobile: '—', supervisor: '—', supervisorMobile: '—',
        photoData: null,
      },
      'partner@efin.com': {
        firstName: 'Partner', middleName: '', lastName: 'User',
        gender: 'M', mobile: '8888457978', email: 'partner@efin.com',
        dob: '1992-09-26', employeeId: '61126870',
        addressLine1: '', addressLine2: '', postalCode: '', city: 'Nagpur', state: 'Maharashtra',
        accountHolderName: 'Wingsgro Monetary Key', bankName: 'YES BANK LTD',
        accountType: 'Savings', accountNumber: '016463300006181', ifscCode: 'YESB0000164',
        businessHead: 'Rakesh Lalbahadur Yadav', partnerName: 'Anand Rai',
        partnerCode: '9773170518', rm: '—', rmMobile: '—', supervisor: '—', supervisorMobile: '—',
        photoData: null,
      },
      'accounts@efin.com': {
        firstName: 'Accounts', middleName: '', lastName: 'Team',
        gender: 'F', mobile: '9900000006', email: 'accounts@efin.com',
        dob: '1991-04-18', employeeId: 'EMP-ACC-006',
        addressLine1: '', addressLine2: '', postalCode: '', city: '', state: '',
        accountHolderName: '', bankName: '', accountType: 'Savings', accountNumber: '', ifscCode: '',
        businessHead: '—', partnerName: '—', partnerCode: '—',
        rm: '—', rmMobile: '—', supervisor: '—', supervisorMobile: '—',
        photoData: null,
      },
    };

    // Restore any previously saved profile edits from localStorage
    (function() {
      try {
        const saved = localStorage.getItem('efin_user_profiles');
        if (saved) {
          const parsed = JSON.parse(saved);
          Object.keys(parsed).forEach(email => {
            USER_PROFILES[email] = Object.assign(USER_PROFILES[email] || {}, parsed[email]);
          });
        }
      } catch(e) {}
    })();

    function saveProfilesToStorage() {
      try { localStorage.setItem('efin_user_profiles', JSON.stringify(USER_PROFILES)); } catch(e) {}
    }

    // All logged-in users can edit their own profile; admins/accounts/ops can edit any profile
    function profileCanEdit() {
      return !!currentUser && !!currentUser.name;
    }

    function getProfileData() {
      // Prefer direct email lookup (currentUser.email always set after login)
      const email = currentUser.email
        || USER_ACCOUNTS.find(u => u.name === currentUser.name)?.email
        || '';
      // Ensure USER_PROFILES entry exists for this user
      if (email && !USER_PROFILES[email]) {
        USER_PROFILES[email] = {
          firstName: currentUser.name.split(' ')[0] || '',
          middleName: '', lastName: currentUser.name.split(' ').slice(1).join(' ') || '',
          gender: '', mobile: '', email: email, dob: '', employeeId: '',
          addressLine1: '', addressLine2: '', postalCode: '', city: '', state: '',
          accountHolderName: '', bankName: '', accountType: 'Savings', accountNumber: '', ifscCode: '',
          businessHead: '—', partnerName: '—', partnerCode: '—',
          rm: '—', rmMobile: '—', supervisor: '—', supervisorMobile: '—',
          photoData: null,
        };
      }
      return USER_PROFILES[email] || {
        firstName: currentUser.name.split(' ')[0] || '',
        middleName: '', lastName: currentUser.name.split(' ').slice(1).join(' ') || '',
        gender: '', mobile: '', email: email, dob: '', employeeId: '',
        addressLine1: '', addressLine2: '', postalCode: '', city: '', state: '',
        accountHolderName: '', bankName: '', accountType: 'Savings', accountNumber: '', ifscCode: '',
        businessHead: '—', partnerName: '—', partnerCode: '—',
        rm: '—', rmMobile: '—', supervisor: '—', supervisorMobile: '—',
        photoData: null,
      };
    }

    function renderProfilePage() {
      const p = getProfileData();
      const rd = ROLES[currentUser.role];
      const isPartner = currentUser.role === 'partner';
      const canEdit = profileCanEdit();

      // Top avatar + name
      const initials = (p.firstName[0]||'') + (p.lastName[0]||'') || currentUser.name.slice(0,2).toUpperCase();
      const fullName = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') || currentUser.name;
      const roleLbl = rd?.label || currentUser.role;
      const roleKey = currentUser.role;

      // Top bar avatar
      const topAvi = document.getElementById('profile-top-avatar');
      const topName = document.getElementById('profile-top-name');
      if (topAvi) { topAvi.textContent = p.photoData ? '' : initials; topAvi.style.background = p.photoData ? 'transparent' : 'var(--accent2)'; if (p.photoData) { topAvi.style.backgroundImage = `url(${p.photoData})`; topAvi.style.backgroundSize = 'cover'; } }
      if (topName) topName.textContent = fullName;

      // Dropdown
      const ddName = document.getElementById('profile-dd-name'); if (ddName) ddName.textContent = fullName;
      const ddEmail = document.getElementById('profile-dd-email'); if (ddEmail) ddEmail.textContent = p.email;
      const ddAvi = document.getElementById('profile-dd-avatar'); if (ddAvi) { ddAvi.textContent = p.photoData ? '' : initials; ddAvi.style.background = p.photoData ? 'transparent' : 'var(--accent2)'; if (p.photoData) { ddAvi.style.backgroundImage = `url(${p.photoData})`; ddAvi.style.backgroundSize = 'cover'; } }

      // Banner
      const bannerAvi = document.getElementById('profile-banner-avatar');
      if (bannerAvi) {
        if (p.photoData) { bannerAvi.style.backgroundImage = `url(${p.photoData})`; bannerAvi.style.backgroundSize = 'cover'; bannerAvi.textContent = ''; }
        else { bannerAvi.textContent = initials; bannerAvi.style.backgroundImage = ''; }
      }
      const bName = document.getElementById('profile-banner-name'); if (bName) bName.textContent = fullName;
      const bRole = document.getElementById('profile-banner-role');
      if (bRole) bRole.innerHTML = `<span style="background:${rd?.color||'#eee'};color:${rd?.textColor||'#333'};padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700">${roleLbl}</span>`;
      const bEmail = document.getElementById('profile-banner-email'); if (bEmail) bEmail.textContent = p.email || '—';
      const bPhone = document.getElementById('profile-banner-phone'); if (bPhone) bPhone.textContent = p.mobile ? `+91-${p.mobile}` : '—';
      const bId = document.getElementById('profile-banner-id'); if (bId) bId.textContent = p.employeeId || '—';

      // Account status badge
      const accountStatus = document.getElementById('profile-account-status');
      if (accountStatus) accountStatus.textContent = 'Active';

      // Last login and account age
      const lastLogin = document.getElementById('profile-last-login');
      if (lastLogin) lastLogin.textContent = p.lastLogin || 'Just now';

      const accountAge = document.getElementById('profile-account-age');
      if (accountAge) {
        // Calculate account age from creation or membership date
        accountAge.textContent = p.accountAge || 'Member since signup';
      }

      // Payout stats (if applicable to user role)
      const payoutStatsContainer = document.getElementById('profile-payout-stats');
      if (payoutStatsContainer && (roleKey === 'partner' || roleKey === 'sales')) {
        // Show payout stats for partners and sales users
        payoutStatsContainer.style.display = '';
        
        // Calculate stats from PAYOUT_CLAIMS
        const userClaims = (typeof PAYOUT_CLAIMS !== 'undefined' && PAYOUT_CLAIMS) 
          ? PAYOUT_CLAIMS.filter(c => c.partner === fullName || c.partner === currentUser.name) 
          : [];
        
        const totalClaims = userClaims.length;
        const totalClaimed = userClaims.reduce((s, c) => s + Number(c.claimAmount || 0), 0);
        const paidClaims = userClaims.filter(c => c.status === 'paid');
        const paidAmount = paidClaims.reduce((s, c) => s + Number(c.payoutAmount || 0), 0);
        const pendingClaims = userClaims.filter(c => c.status === 'pending');
        const pendingAmount = pendingClaims.reduce((s, c) => s + Number(c.claimAmount || 0), 0);
        const approvedClaims = userClaims.filter(c => c.status === 'approved');
        const approvalRate = totalClaims > 0 ? Math.round((approvedClaims.length / totalClaims) * 100) : 0;

        const setEl = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        setEl('profile-stats-total-claims', totalClaims);
        setEl('profile-stats-total-claimed', 'claimed ₹' + (totalClaimed > 0 ? totalClaimed.toLocaleString('en-IN') : '0'));
        setEl('profile-stats-received', '₹' + (paidAmount > 0 ? paidAmount.toLocaleString('en-IN') : '0'));
        setEl('profile-stats-received-count', paidClaims.length + (paidClaims.length !== 1 ? ' times' : ' time'));
        setEl('profile-stats-pending', pendingClaims.length);
        setEl('profile-stats-pending-amount', '₹' + (pendingAmount > 0 ? pendingAmount.toLocaleString('en-IN') : '0') + ' value');
        setEl('profile-stats-approval-rate', approvalRate + '%');
      } else if (payoutStatsContainer) {
        payoutStatsContainer.style.display = 'none';
      }


      // Show/hide Edit buttons
      ['primary','address','bank'].forEach(section => {
        const btn = document.getElementById(`profile-edit-${section}-btn`);
        if (btn) btn.style.display = canEdit ? 'flex' : 'none';
      });

      // System Email tab removed — email configuration now lives in Settings → Mail & Email

      // Render field grids
      profileRenderField('profile-primary-view', [
        { label: 'First Name',           value: p.firstName  },
        { label: 'Middle Name',          value: p.middleName },
        { label: 'Last Name',            value: p.lastName   },
        { label: 'Gender',               value: p.gender === 'M' ? 'Male' : p.gender === 'F' ? 'Female' : (p.gender || '—') },
        { label: 'Mobile Number',        value: p.mobile ? `+91-${p.mobile}` : '—' },
        { label: 'Email',                value: p.email      },
        { label: 'Employee / Partner ID',value: p.employeeId || '—' },
        { label: 'Date of Birth',        value: p.dob ? p.dob.split('-').reverse().join('-') : '—', full: true },
      ]);

      profileRenderField('profile-address-view', [
        { label: 'Address Line 1', value: p.addressLine1 },
        { label: 'Address Line 2', value: p.addressLine2 },
        { label: 'Postal Code',    value: p.postalCode   },
        { label: 'City',           value: p.city         },
        { label: 'State',          value: p.state, full: true },
      ]);

      profileRenderField('profile-bank-view', [
        { label: 'Account Holder Name', value: p.accountHolderName, full: true },
        { label: 'Bank Name',           value: p.bankName           },
        { label: 'Account Type',        value: p.accountType        },
        { label: 'Account Number',      value: p.accountNumber      },
        { label: 'IFSC Code',           value: p.ifscCode, full: true },
      ]);
    }

    function profileRenderField(containerId, fields) {
      const el = document.getElementById(containerId); if (!el) return;
      el.innerHTML = fields.map(f => `
        <div style="${f.full ? 'grid-column:1/-1' : ''}">
          <div style="font-size:11.5px;font-weight:600;color:var(--accent);margin-bottom:5px;letter-spacing:.2px">${f.label}</div>
          <div style="font-size:14px;color:var(--text);font-weight:500">${f.value || '—'}</div>
        </div>`).join('');
    }

    function profileSwitchTab(tab, el) {
      document.querySelectorAll('#page-profile .tab').forEach(t => t.classList.remove('active'));
      if (el) el.classList.add('active');
      document.getElementById('profile-tab-about').style.display     = tab === 'about'     ? '' : 'none';
      document.getElementById('profile-tab-documents').style.display = tab === 'documents' ? '' : 'none';
    }

    function profileOpenEdit(section) {
      if (!profileCanEdit()) { showToast('Please log in to edit your profile', 'error'); return; }
      const p = getProfileData();
      const title = document.getElementById('profile-edit-modal-title');
      const body  = document.getElementById('profile-edit-modal-body');

      if (section === 'primary') {
        if (title) title.textContent = '✎ Edit Primary Details';
        if (body) body.innerHTML = `
          <div class="form-grid" style="margin-bottom:16px">
            <div class="form-group"><label>First Name</label><input type="text" id="pe-fname" value="${p.firstName||''}"></div>
            <div class="form-group"><label>Middle Name</label><input type="text" id="pe-mname" value="${p.middleName||''}"></div>
            <div class="form-group"><label>Last Name</label><input type="text" id="pe-lname" value="${p.lastName||''}"></div>
            <div class="form-group"><label>Gender</label>
              <select id="pe-gender">
                <option value="">—</option>
                <option value="M" ${p.gender==='M'?'selected':''}>Male</option>
                <option value="F" ${p.gender==='F'?'selected':''}>Female</option>
                <option value="O" ${p.gender==='O'?'selected':''}>Other</option>
              </select>
            </div>
            <div class="form-group"><label>Mobile Number</label><input type="tel" id="pe-mobile" value="${p.mobile||''}" maxlength="10"></div>
            <div class="form-group"><label>Email</label><input type="email" id="pe-email" value="${p.email||''}"></div>
            <div class="form-group"><label>Employee / Partner ID</label><input type="text" id="pe-empid" value="${p.employeeId||''}"></div>
            <div class="form-group"><label>Date of Birth</label><input type="date" id="pe-dob" value="${p.dob||''}"></div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:10px">
            <button class="btn btn-ghost" onclick="closeModal('modal-profile-edit')">Cancel</button>
            <button class="btn btn-primary" onclick="profileSaveEdit('primary')">Save</button>
          </div>`;

      } else if (section === 'address') {
        if (title) title.textContent = '✎ Edit Address Details';
        if (body) body.innerHTML = `
          <div class="form-grid" style="margin-bottom:16px">
            <div class="form-group full"><label>Address Line 1</label><input type="text" id="pe-addr1" value="${p.addressLine1||''}" placeholder="House/Flat, Street"></div>
            <div class="form-group full"><label>Address Line 2</label><input type="text" id="pe-addr2" value="${p.addressLine2||''}" placeholder="Area, Landmark"></div>
            <div class="form-group"><label>Postal Code</label><input type="text" id="pe-postal" value="${p.postalCode||''}" maxlength="6"></div>
            <div class="form-group"><label>City</label><input type="text" id="pe-city" value="${p.city||''}"></div>
            <div class="form-group full"><label>State</label><input type="text" id="pe-state" value="${p.state||''}"></div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:10px">
            <button class="btn btn-ghost" onclick="closeModal('modal-profile-edit')">Cancel</button>
            <button class="btn btn-primary" onclick="profileSaveEdit('address')">Save</button>
          </div>`;

      } else if (section === 'bank') {
        if (title) title.textContent = '✎ Edit Bank Details';
        if (body) body.innerHTML = `
          <div class="form-grid" style="margin-bottom:16px">
            <div class="form-group full"><label>Account Holder Name</label><input type="text" id="pe-accholder" value="${p.accountHolderName||''}"></div>
            <div class="form-group"><label>Bank Name</label><input type="text" id="pe-bankname" value="${p.bankName||''}"></div>
            <div class="form-group"><label>Account Type</label>
              <select id="pe-acctype">
                <option value="Savings" ${p.accountType==='Savings'?'selected':''}>Savings</option>
                <option value="Current" ${p.accountType==='Current'?'selected':''}>Current</option>
              </select>
            </div>
            <div class="form-group"><label>Account Number</label><input type="text" id="pe-accno" value="${p.accountNumber||''}" style="font-family:monospace"></div>
            <div class="form-group"><label>IFSC Code</label><input type="text" id="pe-ifsc" value="${p.ifscCode||''}" style="text-transform:uppercase;font-family:monospace" maxlength="11"></div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:10px">
            <button class="btn btn-ghost" onclick="closeModal('modal-profile-edit')">Cancel</button>
            <button class="btn btn-primary" onclick="profileSaveEdit('bank')">Save</button>
          </div>`;
      }

      openModal('modal-profile-edit');
    }

    function profileSaveEdit(section) {
      const email = currentUser.email
        || USER_ACCOUNTS.find(u => u.name === currentUser.name)?.email
        || '';
      if (!USER_PROFILES[email]) USER_PROFILES[email] = {};
      const p = USER_PROFILES[email];

      if (section === 'primary') {
        p.firstName  = document.getElementById('pe-fname')?.value.trim()  || p.firstName;
        p.middleName = document.getElementById('pe-mname')?.value.trim()  || '';
        p.lastName   = document.getElementById('pe-lname')?.value.trim()  || p.lastName;
        p.gender     = document.getElementById('pe-gender')?.value        || p.gender;
        p.mobile     = document.getElementById('pe-mobile')?.value.trim() || p.mobile;
        p.email      = document.getElementById('pe-email')?.value.trim()  || p.email;
        p.employeeId = document.getElementById('pe-empid')?.value.trim()  || p.employeeId || '';
        p.dob        = document.getElementById('pe-dob')?.value           || p.dob;
      } else if (section === 'address') {
        p.addressLine1 = document.getElementById('pe-addr1')?.value.trim()  || '';
        p.addressLine2 = document.getElementById('pe-addr2')?.value.trim()  || '';
        p.postalCode   = document.getElementById('pe-postal')?.value.trim() || '';
        p.city         = document.getElementById('pe-city')?.value.trim()   || '';
        p.state        = document.getElementById('pe-state')?.value.trim()  || '';
      } else if (section === 'bank') {
        p.accountHolderName = document.getElementById('pe-accholder')?.value.trim() || '';
        p.bankName          = document.getElementById('pe-bankname')?.value.trim()  || '';
        p.accountType       = document.getElementById('pe-acctype')?.value           || 'Savings';
        p.accountNumber     = document.getElementById('pe-accno')?.value.trim()     || '';
        p.ifscCode          = (document.getElementById('pe-ifsc')?.value.trim()     || '').toUpperCase();
      }

      closeModal('modal-profile-edit');
      saveProfilesToStorage();
      renderProfilePage();
      showToast(`${section.charAt(0).toUpperCase()+section.slice(1)} details saved`, 'success');
    }

    function profileUploadAvatar(input) {
      const file = input.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        const email = currentUser.email
          || USER_ACCOUNTS.find(u => u.name === currentUser.name)?.email
          || '';
        if (!USER_PROFILES[email]) USER_PROFILES[email] = {};
        USER_PROFILES[email].photoData = e.target.result;
        saveProfilesToStorage();
        renderProfilePage();
        showToast('Profile photo updated', 'success');
      };
      reader.readAsDataURL(file);
    }

    function toggleProfileDropdown() {
      const dd = document.getElementById('profile-top-dropdown');
      if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    }

    function toggleTopbarProfileDropdown() {
      const dd = document.getElementById('topbar-profile-dropdown');
      if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    }

    // Close dropdowns on outside click
    document.addEventListener('click', function(e) {
      const wrap = document.getElementById('profile-avatar-wrap');
      if (wrap && !wrap.contains(e.target)) {
        const dd = document.getElementById('profile-top-dropdown');
        if (dd) dd.style.display = 'none';
      }
      const tbWrap = document.getElementById('topbar-profile-btn-wrap');
      if (tbWrap && !tbWrap.contains(e.target)) {
        const tbDd = document.getElementById('topbar-profile-dropdown');
        if (tbDd) tbDd.style.display = 'none';
      }
    });

    function doLogout() {
      _lsRemove('efin_session');
      // Remove has-session so CSS re-shows login screen
      document.documentElement.classList.remove('has-session');
      location.hash = '';
      // Show login screen
      const ls = document.getElementById('login-screen');
      if (ls) { ls.style.display = ''; ls.style.removeProperty('display'); }
      // Reload to fully reset all in-memory state
      location.reload();
    }


    // ── Expose functions to window for onclick handlers ──
    // ── Session expiry warning ticker (alerts 15 min before expiry) ──
    (function _sessionExpiryWatcher() {
      var _SESSION_WARN_BEFORE = 15 * 60 * 1000; // 15 min warning
      var _SESSION_MAX_MS = 8 * 60 * 60 * 1000;
      var _warnShown = false;
      setInterval(function() {
        try {
          var sess = JSON.parse(localStorage.getItem('efin_session') || 'null');
          if (!sess || !sess.loginTs) return;
          var age = Date.now() - sess.loginTs;
          var remaining = _SESSION_MAX_MS - age;
          if (remaining <= 0) {
            // Force logout
            if (typeof doLogout === 'function') {
              if (typeof showToast === 'function') showToast('Session expired. Please log in again.', 'warn');
              setTimeout(doLogout, 1500);
            }
          } else if (remaining <= _SESSION_WARN_BEFORE && !_warnShown) {
            _warnShown = true;
            if (typeof showToast === 'function') showToast('⏰ Your session will expire in 15 minutes. Save your work.', 'warn');
          } else if (remaining > _SESSION_WARN_BEFORE) {
            _warnShown = false; // reset if session was refreshed
          }
        } catch(e) {}
      }, 60000); // check every minute
    })();

    window.saveProfilesToStorage = saveProfilesToStorage;
    window.profileCanEdit = profileCanEdit;
    window.getProfileData = getProfileData;
    window.renderProfilePage = renderProfilePage;
    window.profileRenderField = profileRenderField;
    window.profileSwitchTab = profileSwitchTab;
    window.profileOpenEdit = profileOpenEdit;
    window.profileSaveEdit = profileSaveEdit;
    window.profileUploadAvatar = profileUploadAvatar;
    window.toggleProfileDropdown = toggleProfileDropdown;
    window.toggleTopbarProfileDropdown = toggleTopbarProfileDropdown;
    window.doLogout = doLogout;

    // ── KYC Proxy URL Settings UI (injected into Settings page) ──
    function _renderKycProxySettingsCard() {
      var container = document.getElementById('stg-kyc-proxy-container');
      if (!container) return;
      var curUrl = _loadKycProxyUrl();
      container.innerHTML =
        '<div class="stg-section-label" style="margin-top:0">KYC Vision Proxy (AWS Lambda)</div>' +
        '<div style="font-size:12px;color:var(--text3);margin-bottom:10px;line-height:1.6">' +
          'Enter your API Gateway endpoint URL for the KYC OCR Lambda proxy. ' +
          'This keeps your Anthropic API key off the client. ' +
          '<a href="https://docs.aws.amazon.com/lambda/" target="_blank" style="color:var(--accent)">AWS Lambda docs →</a>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<input type="url" id="kyc-proxy-url-input" value="' + (curUrl || '') + '" ' +
            'placeholder="https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com/prod/kyc" ' +
            'style="flex:1;padding:9px 12px;border:1.5px solid var(--border2);border-radius:var(--r-sm);' +
            'font-size:12.5px;font-family:monospace;background:var(--surface2);color:var(--text);outline:none">' +
          '<button onclick="_saveKycProxyUrlFromUI()" class="btn btn-primary btn-sm">Save</button>' +
          '<button onclick="_clearKycProxyUrl()" class="btn btn-ghost btn-sm" style="color:var(--accent2)">Clear</button>' +
        '</div>' +
        (curUrl ? '<div style="margin-top:8px;font-size:11.5px;color:var(--success);font-weight:600">✅ Proxy configured: ' + curUrl.slice(0,60) + (curUrl.length > 60 ? '…' : '') + '</div>'
                : '<div style="margin-top:8px;font-size:11.5px;color:var(--warn)">⚠ No proxy set — KYC OCR will use direct API key (local dev only)</div>');
    }
    function _saveKycProxyUrlFromUI() {
      var val = (document.getElementById('kyc-proxy-url-input')?.value || '').trim();
      _saveKycProxyUrl(val);
      if (typeof showToast === 'function') showToast('KYC proxy URL ' + (val ? 'saved ✓' : 'cleared'), 'success');
      _renderKycProxySettingsCard();
    }
    function _clearKycProxyUrl() {
      _saveKycProxyUrl('');
      var inp = document.getElementById('kyc-proxy-url-input');
      if (inp) inp.value = '';
      if (typeof showToast === 'function') showToast('KYC proxy URL cleared', 'info');
      _renderKycProxySettingsCard();
    }
    window._renderKycProxySettingsCard = _renderKycProxySettingsCard;
    window._saveKycProxyUrlFromUI     = _saveKycProxyUrlFromUI;
    window._clearKycProxyUrl          = _clearKycProxyUrl;

