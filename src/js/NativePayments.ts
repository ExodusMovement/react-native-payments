import { NativeModules, Platform } from 'react-native';

import { PaymentComplete, PaymentDetailsInit, PaymentMethodData } from './types';

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

  // Android show method
  show(
    methodData: PaymentMethodData['data'],
    details: PaymentDetailsInit,
    options: Partial<PaymentOptions>,
    errorCallback: (error: string) => void,
    successCallback: (...args: any[]) => void
  ): void;

  abort(callback: (error: string | null) => void): void;

  complete(
    paymentStatus: PaymentComplete,
    callback: (error: string | null) => void
  ): void;

  openPaymentSetup?: () => void;
}

const ReactNativePayments = NativeModules.ReactNativePayments as ReactNativePaymentsModule

const IS_ANDROID = Platform.OS === 'android';

const noop = () => {};

const NativePayments =  {
  canMakePayments() {
    return new Promise((resolve, reject) => {
      if (IS_ANDROID) {
        // ReactNativePayments.canMakePayments(
        //   methodData,
        //   err => reject(err),
        //   canMakePayments => resolve(canMakePayments)
        // );

        return false
      }

      // On iOS, canMakePayments is exposed as a constant.
      resolve(ReactNativePayments.canMakePayments);
    });
  },

  canMakePaymentsUsingNetworks(usingNetworks: []) {
    // IOS method to check that user has available cards at Apple Pay
    // https://developer.apple.com/documentation/passkit/pkpaymentauthorizationviewcontroller/1616187-canmakepaymentsusingnetworks?language=occ

    return new Promise(resolve => {
      if (IS_ANDROID) {
        resolve(false);
      }

      ReactNativePayments.canMakePaymentsUsingNetworks(
        usingNetworks,
        (err, data) => resolve(data)
      );
    });
  },

  createPaymentRequest(
    methodData: PaymentMethodData['data'],
    details: PaymentDetailsInit,
    options: Partial<PaymentOptions> = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Android Pay doesn't a PaymentRequest interface on the
      // Java side.  So we create and show Android Pay when
      // the user calls `.show`.
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
  },

  handleDetailsUpdate(details: PaymentDetailsInit): Promise<void> {
    return new Promise((resolve, reject) => {
      // Android doesn't have display items, so we noop.
      // Users need to create a new Payment Request if they
      // need to update pricing.
      if (IS_ANDROID) return resolve(undefined);

      ReactNativePayments.handleDetailsUpdate(
        details,
        err => err ? reject(err) : resolve()
      );
    });
  },

  show(
    methodData: PaymentMethodData['data'],
    details: PaymentDetailsInit,
    options: Partial<PaymentOptions> = {}
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (IS_ANDROID) {
        ReactNativePayments.show(
          methodData,
          details,
          options,
          err => reject(err),
          (...args) => {
            console.log(args);
            resolve(true);
          }
        );

        return;
      }

      ReactNativePayments.show((err, paymentToken) => {
        if (err) return reject(err);
        resolve(true);
      });
    });
  },

  abort(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (IS_ANDROID) {
        // TODO
        resolve(undefined);

        return;
      }

      ReactNativePayments.abort(err => err ? reject(err) : resolve());
    });
  },

  complete(paymentStatus: PaymentComplete): Promise<void> {
    return new Promise((resolve, reject) => {
      // Android doesn't have a loading state, so we noop.
      if (IS_ANDROID) {
        resolve(undefined);

        return;
      }

      ReactNativePayments.complete(
        paymentStatus,
        err => err ? reject(err) : resolve()
      );
    });
  },

  // getFullWalletAndroid(
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
  // },

  openPaymentSetup:
    (ReactNativePayments && ReactNativePayments.openPaymentSetup) || noop
};

export default NativePayments;
