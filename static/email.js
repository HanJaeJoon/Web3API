const initialize = async () => {
  const userInfo = { address: null, email: null, authKey: null };
  // controls
  const inputEmail = document.getElementById('email');

  const setEmail = () => {
    const email = inputEmail.value;
    const authKey = window.location.pathname.split('/')[1];

    if (email) {
      userInfo.email = email;
      inputEmail.value = email;
    } else {
      inputEmail.value = '';
      inputEmail.disabled = false;
    }

    userInfo.authKey = authKey;
  };

  // Web3
  const { ethereum, $ } = window;
  const { host } = window.location;

  // eslint-disable-next-line no-undef
  const onboarding = new MetaMaskOnboarding({ host });
  const address = document.getElementById('address');
  const btnSave = document.getElementById('btn-save');
  const btnFetch = document.getElementById('btn-fetch');

  const isMetaMaskInstalled = () => Boolean(ethereum && ethereum.isMetaMask);

  const fetchNftData = async () => {
    if (!userInfo.address) {
      alert('지갑 연동을 완료해주세요.');
      return;
    }

    const tableBody = document.getElementById('table-body');

    tableBody.innerHTML = '';

    fetch(`./api/fetchAssets/${userInfo.address}`)
      .then(async (response) => {
        if (response.ok) {
          return response.json();
        }

        const text = await response.text();
        throw new Error(text);
      })
      .then((data) => {
        const { assets } = data;
        let htmlString = '';

        for (let i = 0; i < assets.length; i += 1) {
          const asset = assets[i];

          htmlString += `
            <tr>
              <td scope="row">${i + 1}</td>
              <td>
                <a href="${asset.permalink}">
                  <image src="${asset.image_thumbnail_url}">
                </a>
              </td>
            </tr>
          `;
        }

        tableBody.innerHTML = htmlString;
      })
      .catch((error) => {
        alert(`에러 발생!\n${error}`);
      });
  };

  function handleNewAccounts(newAccounts) {
    const newAccount = newAccounts[0];

    userInfo.address = newAccount;
    address.value = newAccount;

    fetchNftData();
  }

  const metaMaskClientCheck = async () => {
    const queryString = window.location.search;
    const params = new URLSearchParams(queryString);
    const metamaskApp = params.get('metamaskApp');

    if (metamaskApp !== 'true') {
      const mobileMatch = [
        /Android/i,
        /webOS/i,
        /iPhone/i,
        /iPad/i,
        /iPod/i,
        /BlackBerry/i,
        /Windows Phone/i,
      ];

      if (mobileMatch.some((toMatchItem) => navigator.userAgent.match(toMatchItem))) {
        const url = window.location.href;

        window.location.href = `https://metamask.app.link/dapp/${url}?metamaskApp=true`;
        return;
      }
    }

    if (isMetaMaskInstalled()) {
      ethereum.autoRefreshOnNetworkChange = false;
      ethereum.on('accountsChanged', handleNewAccounts);

      try {
        const newAccounts = await ethereum.request({ method: 'eth_accounts' });

        if (newAccounts.length > 0) {
          handleNewAccounts(newAccounts);
        } else {
          ethereum.request({ method: 'eth_requestAccounts' });
        }
      } catch (err) {
        console.error('Error on init when getting accounts', err);
      }
    } else {
      $('#install-modal').modal('show');

      document.getElementById('install').addEventListener('click', async () => {
        onboarding.startOnboarding();
      });
    }
  };

  btnSave.addEventListener('click', async () => {
    if (!userInfo.email) {
      alert('잘못된 접근입니다.');
      return;
    }

    if (!userInfo.address) {
      alert('지갑 연동을 완료해주세요.');
      return;
    }

    fetch('/api/saveUserAddress', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(userInfo),
    })
      .then(async (response) => {
        if (response.ok) {
          alert('NFT 신청 성공!');
          return;
        }

        const text = await response.text();
        throw new Error(text);
      })
      .catch((error) => {
        alert(`에러 발생!\n${error}`);
      });
  });

  btnFetch.addEventListener('click', fetchNftData);

  setEmail();
  metaMaskClientCheck();
};

window.addEventListener('DOMContentLoaded', initialize);
