import { NativeModules, Platform } from 'react-native';
import { PaymentDetailsInit, PaymentMethodData, PaymentOptions } from './types';

interface ReactNativePaymentsModule {
  canMakePayments: boolean;

  canMakePaymentsUsingNetworks(
    usingNetworks: string[],
    callback: (error: string | null, data: boolean) => void
  ): void;

  createPaymentRequest(
    methodData: PaymentMethodData['data'],
    details: PaymentDetailsInit,
    options: Partial<PaymentOptions>,
    callback: (error: string | null) => void
  ): void;

  handleDetailsUpdate(
    details: PaymentDetailsInit,
    callback: (error: string | null) => void
  ): void;

  // iOS show method
  show(callback: (error: string | null, paymentToken?: any) => void): void;

  // // Android show method
  // show(
  //   methodData: PaymentMethodData['data'],
  //   details: PaymentDetailsInit,
  //   options: Partial<PaymentOptions>,
  //   errorCallback: (error: string) => void,
  //   successCallback: (...args: any[]) => void
  // ): void;

  abort(callback: (error: string | null) => void): void;

  complete(
    paymentStatus: PaymentComplete,
    callback: (error: string | null) => void
  ): void;

  openPaymentSetup?: () => void;
}

const ReactNativePayments = NativeModules.ReactNativePayments as ReactNativePaymentsModule;

const IS_ANDROID = Platform.OS === 'android';

const noop = () => {};

const isSupported = IS_ANDROID ? false :ReactNativePayments.canMakePayments

// For Android: ReactNativePayments.canMakePayments(methodData, err => reject(err), canMakePayments => resolve(canMakePayments));
// On iOS, canMakePayments is exposed as a constant.
function canMakePayments(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    resolve(isSupported);
  });
}

// IOS method to check that user has available cards at Apple Pay
// https://developer.apple.com/documentation/passkit/pkpaymentauthorizationviewcontroller/1616187-canmakepaymentsusingnetworks?language=occ
function canMakePaymentsUsingNetworks(usingNetworks: []): Promise<boolean> {
  return new Promise(resolve => {
    if (IS_ANDROID) return resolve(false);

    ReactNativePayments.canMakePaymentsUsingNetworks(
      usingNetworks,
      (err, data) => resolve(data)
    );
  });
}

// Android Pay doesn't a PaymentRequest interface on the
// Java side.  So we create and show Android Pay when the user calls `.show`.
function createPaymentRequest(
  methodData: PaymentMethodData['data'],
  details: PaymentDetailsInit,
  options: Partial<PaymentOptions> = Object.create(null)
): Promise<void> {
  return new Promise((resolve, reject) => {

    if (IS_ANDROID) {
      return resolve();
    }

    ReactNativePayments.createPaymentRequest(
      methodData,
      details,
      options,
      err => err ? reject(err) : resolve(),
    );
  });
}

// Android doesn't have display items, so we noop.
// Users need to create a new Payment Request if they
// need to update pricing.
function handleDetailsUpdate(details: PaymentDetailsInit): Promise<void> {
  return new Promise((resolve, reject) => {
    if (IS_ANDROID) return resolve(undefined);

    ReactNativePayments.handleDetailsUpdate(
      details,
      err => err ? reject(err) : resolve(),
    );
  });
}


// For Android: ReactNativePayments.show(methodData,
//   details,
//   options,
//   err => reject(err),
//   (...args) => {
//     console.log(args);
//     resolve(true);
//   }
// );
function show() {
  return new Promise((resolve, reject) => {
    if (IS_ANDROID) return reject(new Error('NotSupportedError'));

    ReactNativePayments.show((err, paymentToken) => {
      return err ? reject(err) : resolve(true);
    });
  });
}

function abort() {
  return new Promise((resolve, reject) => {
    if (IS_ANDROID) return resolve(undefined);

    ReactNativePayments.abort(err => err ? reject(err) : resolve(true));
  });
}

function complete(paymentStatus: PaymentComplete) {
  return new Promise((resolve, reject) => {
    if (IS_ANDROID) return resolve(undefined);

    ReactNativePayments.complete(
      paymentStatus,
      err => err ? reject(err) : resolve(true),
    );
  });
}

const openPaymentSetup =
    (ReactNativePayments && ReactNativePayments.openPaymentSetup) || noop

// function getFullWalletAndroid(
//   googleTransactionId: string,
//   paymentMethodData: object,
//   details: object
// ): Promise<string> {
//   return new Promise((resolve, reject) => {
//     if (!IS_ANDROID) {
//       reject(new Error('This method is only available on Android.'));

//       return;
//     }

//     ReactNativePayments.getFullWalletAndroid(
//       googleTransactionId,
//       paymentMethodData,
//       details,
//       err => reject(err),
//       serializedPaymentToken =>
//         resolve({
//           serializedPaymentToken,
//           paymentToken: JSON.parse(serializedPaymentToken),
//           /** Leave previous typo in order not to create a breaking change **/
//           serializedPaymenToken: serializedPaymentToken,
//           paymenToken: JSON.parse(serializedPaymentToken)
//         })
//     );
//   });
// }

const NativePayments = {
  isSupported,
  canMakePayments,
  canMakePaymentsUsingNetworks,
  createPaymentRequest,
  handleDetailsUpdate,
  show,
  abort,
  complete,
  openPaymentSetup,
};

export default NativePayments;
