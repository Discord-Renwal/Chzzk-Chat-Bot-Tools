/**
 * PortOne 브라우저 SDK 연동.
 *
 * 카드 정보를 우리 서버가 절대 만지지 않는 게 핵심입니다. 브라우저가 PG 창에서
 * 직접 카드를 입력하고 **빌링키 발급 식별자(issueId)** 만 우리에게 넘깁니다.
 * 그 식별자로 서버가 PG 에 다시 물어 실제 빌링키를 받습니다 — 그래서 카드번호가
 * 우리 네트워크를 지나가지 않고, PCI-DSS 범위에서도 벗어납니다.
 *
 * SDK 는 전역 스크립트라 한 번만 붙입니다. 여러 화면에서 각자 로드하면 서로의
 * 로드 상태를 모른 채 중복으로 붙고, 그때 발급 콜백이 두 번 불립니다.
 */

const SDK_URL = 'https://cdn.portone.io/v2/browser-sdk.js';

interface PortOneBillingKeyRequest {
  storeId: string;
  channelKey: string;
  billingKeyMethod: 'CARD';
  issueId: string;
  issueName: string;
  customer: { customerId: string; fullName: string; email?: string };
  redirectUrl?: string;
}

interface PortOneBillingKeyResponse {
  billingKey?: string;
  code?: string;
  message?: string;
}

interface PortOneSdk {
  requestIssueBillingKey(request: PortOneBillingKeyRequest): Promise<PortOneBillingKeyResponse>;
}

declare global {
  interface Window {
    PortOne?: PortOneSdk;
  }
}

let loading: Promise<PortOneSdk> | undefined;

function loadSdk(): Promise<PortOneSdk> {
  if (window.PortOne) return Promise.resolve(window.PortOne);

  loading ??= new Promise<PortOneSdk>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => {
      if (window.PortOne) resolve(window.PortOne);
      else reject(new Error('결제 모듈을 불러오지 못했습니다.'));
    };
    script.onerror = () => {
      // 다음 시도에서 다시 붙일 수 있도록 캐시를 비웁니다. 비우지 않으면
      // 일시적인 네트워크 오류 한 번이 영구적인 결제 불가로 굳습니다.
      loading = undefined;
      reject(new Error('결제 모듈을 불러오지 못했습니다. 네트워크를 확인해 주세요.'));
    };
    document.head.appendChild(script);
  });

  return loading;
}

export interface IssueBillingKeyParams {
  storeId: string;
  channelKey: string;
  customerId: string;
  customerName: string;
  planName: string;
}

export interface IssuedBillingKeyResult {
  issueId: string;
  billingKeyRequestId: string;
}

/**
 * 카드 등록 창을 띄우고 발급 식별자를 받습니다.
 *
 * 반환값에는 **빌링키가 없습니다**. 있어도 쓰면 안 되고, 서버가 issueId 로 직접
 * 조회합니다. 클라이언트가 준 빌링키를 그대로 믿으면 남의 빌링키를 자기 계정에
 * 붙일 수 있습니다.
 */
export async function issueBillingKey(
  params: IssueBillingKeyParams
): Promise<IssuedBillingKeyResult> {
  const sdk = await loadSdk();

  // 우리가 만드는 발급 요청 식별자. 같은 값으로 두 번 부르면 PG 가 막아 줍니다.
  const issueId = `bk_${params.customerId.slice(0, 8)}_${crypto.randomUUID().slice(0, 12)}`;

  const response = await sdk.requestIssueBillingKey({
    storeId: params.storeId,
    channelKey: params.channelKey,
    billingKeyMethod: 'CARD',
    issueId,
    issueName: `${params.planName} 정기결제`,
    customer: { customerId: params.customerId, fullName: params.customerName },
  });

  // 사용자가 창을 닫으면 code 가 채워져 돌아옵니다. 오류가 아니라 취소입니다.
  if (response.code) {
    throw new Error(response.message ?? '결제가 취소되었습니다.');
  }

  return { issueId, billingKeyRequestId: issueId };
}

/**
 * 모의 모드에서 결제창 없이 통과시킵니다.
 *
 * 로컬 개발에서 PG 계정 없이도 구독 흐름 전체를 눌러 볼 수 있어야 합니다.
 * 서버도 같은 조건(`PORTONE_MOCK`)에서 목 게이트웨이를 쓰므로 짝이 맞습니다.
 */
export function issueMockBillingKey(customerId: string): IssuedBillingKeyResult {
  const issueId = `mock_${customerId.slice(0, 8)}_${crypto.randomUUID().slice(0, 12)}`;
  return { issueId, billingKeyRequestId: issueId };
}
