import { DeviceEventEmitter, EmitterSubscription, Platform } from 'react-native';
import { randomUUID } from '@exodus/crypto/randomUUID';

import NativePayments from './NativePayments';
import PaymentResponse from './PaymentResponse';
import PaymentRequestUpdateEvent from './PaymentRequestUpdateEvent';
import { ConstructorError } from './errors';
import type PaymentResponseType from './PaymentResponse';

import {
  convertDetailAmountsToString,
  getPlatformMethodData,
  validateTotal,
  validatePaymentMethods,
  validateDisplayItems,
  validateShippingOptions,
  getSelectedShippingOption,
  transformMerchantCapabilities
} from './helpers';

import {
  SHIPPING_ADDRESS_CHANGE_EVENT,
  SHIPPING_OPTION_CHANGE_EVENT,
  INTERNAL_SHIPPING_ADDRESS_CHANGE_EVENT,
  INTERNAL_SHIPPING_OPTION_CHANGE_EVENT,
  USER_DISMISS_EVENT,
  USER_ACCEPT_EVENT
} from './constants';

import type {
  PaymentMethodData,
  PaymentDetailsInit,
  PaymentOptions,
  PaymentAddress,
  PaymentShippingType,
  PaymentDetailsIOSRaw,
  PaymentDetailsIOS,
} from './types';

const noop = () => {};
const IS_ANDROID = Platform.OS === 'android';
const IS_IOS = Platform.OS === 'ios';

export default class PaymentRequest {
  _id: string;
  _shippingAddress: null | PaymentAddress;
  _shippingOption: null | string;
  _shippingType: null | PaymentShippingType;

  _acceptPromiseResolver?: (value: PaymentResponse) => void;
  _acceptPromiseRejecter?: (reason: any) => void;

  _serializedMethodData: string;
  _details: PaymentDetailsInit;
  _options: Partial<PaymentOptions>;
  _state: 'created' | 'interactive' | 'closed';
  _updating: boolean;

  _shippingAddressChangesCount: number;
  _shippingAddressChangeFn?: (event: PaymentRequestUpdateEvent) => void;
  _shippingOptionChangeFn?: (event: PaymentRequestUpdateEvent) => void;

  _shippingAddressChangeSubscription?: EmitterSubscription
  _shippingOptionChangeSubscription?: EmitterSubscription
  _userDismissSubscription?: EmitterSubscription
  _userAcceptSubscription?: EmitterSubscription

  static canMakePaymentsUsingNetworks =
    NativePayments.canMakePaymentsUsingNetworks;

  static MerchantCapabilities = {
    debit: 'debit',
    credit: 'credit',
    emv: 'emv'
  };

  constructor(
    methodData: PaymentMethodData[] = [],
    details: PaymentDetailsInit,
    options: Partial<PaymentOptions> = {}
  ) {
    options = { ...options };

    options.merchantCapabilities = transformMerchantCapabilities(options.merchantCapabilities);


    // 1. If the current settings object's responsible document is not allowed to use the feature indicated by attribute name allowpaymentrequest, then throw a " SecurityError" DOMException.
    noop();

    // 2. Let serializedMethodData be an empty list.
    // happens in `processPaymentMethods`

    // 3. Establish the request's id:
    if (!details.id) {
      details.id = randomUUID();
    }

    // 4. Process payment methods
    validatePaymentMethods(methodData);

    // 5. Process the total
    validateTotal(details.total, ConstructorError);

    // 6. If the displayItems member of details is present, then for each item in details.displayItems:
    validateDisplayItems(details.displayItems, ConstructorError);

    // 7. Let selectedShippingOption be null.
    let selectedShippingOption = null;

    // 8. Process shipping options
    validateShippingOptions(details, ConstructorError);

    if (IS_IOS) {
      selectedShippingOption = getSelectedShippingOption(
        details.shippingOptions
      );
    }

    // 9. Let serializedModifierData be an empty list.
    noop();

    // 10. Process payment details modifiers:
    // TODO: Look into how payment details modifiers are used.
    // processPaymentDetailsModifiers(details, serializedModifierData)

    // 11. Let request be a new PaymentRequest.
    noop();

    // 12. Set request.[[options]] to options.
    this._options = options;

    // 13. Set request.[[state]] to "created".
    this._state = 'created';

    // 14. Set request.[[updating]] to false.
    this._updating = false;

    // 15. Set request.[[details]] to details.
    this._details = details;

    // 16. Set request.[[serializedModifierData]] to serializedModifierData.

    // 17. Set request.[[serializedMethodData]] to serializedMethodData.
    this._serializedMethodData = JSON.stringify(methodData);

    // Set attributes (18-20)
    this._id = details.id;

    // 18. Set the value of request's shippingOption attribute to selectedShippingOption.
    this._shippingOption = selectedShippingOption;

    // 19. Set the value of the shippingAddress attribute on request to null.
    this._shippingAddress = null;

    // 20. If options.requestShipping is set to true, then set the value of the shippingType attribute on request to options.shippingType. Otherwise, set it to null.
    this._shippingType =
      IS_IOS && options.shippingType && options.requestShipping === true ? options.shippingType : null;

    // Setup event listeners
    this._setupEventListeners();

    // Set the amount of times `_handleShippingAddressChange` has been called.
    // This is used on iOS to noop the first call.
    this._shippingAddressChangesCount = 0;

    const platformMethodData = getPlatformMethodData(methodData, Platform.OS);
    const normalizedDetails = convertDetailAmountsToString(details);

    NativePayments.createPaymentRequest(
      platformMethodData,
      normalizedDetails,
      options
    );
  }

  _setupEventListeners() {
    this._userDismissSubscription = DeviceEventEmitter.addListener(
      USER_DISMISS_EVENT,
      this._closePaymentRequest.bind(this)
    );

    this._userAcceptSubscription = DeviceEventEmitter.addListener(
      USER_ACCEPT_EVENT,
      this._handleUserAccept.bind(this)
    );

    if (IS_IOS) {
      // https://www.w3.org/TR/payment-request/#onshippingoptionchange-attribute
      this._shippingOptionChangeSubscription = DeviceEventEmitter.addListener(
        INTERNAL_SHIPPING_OPTION_CHANGE_EVENT,
        this._handleShippingOptionChange.bind(this)
      );

      // https://www.w3.org/TR/payment-request/#onshippingaddresschange-attribute
      this._shippingAddressChangeSubscription = DeviceEventEmitter.addListener(
        INTERNAL_SHIPPING_ADDRESS_CHANGE_EVENT,
        this._handleShippingAddressChange.bind(this)
      );
    }
  }

  _handleShippingAddressChange(postalAddress: PaymentAddress) {
    this._shippingAddress = postalAddress;

    const event = new PaymentRequestUpdateEvent(
      SHIPPING_ADDRESS_CHANGE_EVENT,
      this
    );
    this._shippingAddressChangesCount++;

    // On iOS, this event fires when the PKPaymentRequest is initialized.
    // So on iOS, we track the amount of times `_handleShippingAddressChange` gets called
    // and noop the first call.
    if (IS_IOS && this._shippingAddressChangesCount === 1) {
      return event.updateWith(this._details as any);
    }

    // Eventually calls `PaymentRequestUpdateEvent._handleDetailsUpdate` when
    // after a details are returned
    this._shippingAddressChangeFn?.(event);
  }

  _handleShippingOptionChange(value: { selectedShippingOptionId: string }) {
    this._shippingOption = value.selectedShippingOptionId;

    const event = new PaymentRequestUpdateEvent(
      SHIPPING_OPTION_CHANGE_EVENT,
      this
    );

    this._shippingOptionChangeFn?.(event);
  }

  // _getPlatformDetailsAndroid(details: PaymentDetailsAndroid) {
  //   const { googleTransactionId, paymentDescription } = details;

  //   // On Android, the recommended flow is to have user's confirm prior to retrieving the full wallet.
  //   return {
  //     googleTransactionId,
  //     paymentDescription,
  //     getPaymentToken: () =>
  //       NativePayments.getFullWalletAndroid(
  //         googleTransactionId,
  //         getPlatformMethodData(
  //           JSON.parse(this._serializedMethodData), Platform.OS
  //         ),
  //         convertDetailAmountsToString(this._details)
  //       )
  //   };
  // }

  _getPlatformDetails(details: PaymentDetailsIOSRaw): PaymentDetailsIOS {
    const {
      paymentData: serializedPaymentData,
      billingContact: serializedBillingContact,
      shippingContact: serializedShippingContact,
      paymentToken,
      transactionIdentifier,
      paymentMethod
    } = details;

    const isSimulator = transactionIdentifier === 'Simulated Identifier';

    let billingContact = null;
    let shippingContact = null;

    if (serializedBillingContact && serializedBillingContact !== '') {
      try {
        billingContact = JSON.parse(serializedBillingContact);
      } catch (e) {}
    }

    if (serializedShippingContact && serializedShippingContact !== '') {
      try {
        shippingContact = JSON.parse(serializedShippingContact);
      } catch (e) {}
    }

    return {
      paymentData: isSimulator ? null : JSON.parse(serializedPaymentData),
      billingContact,
      shippingContact,
      paymentToken,
      transactionIdentifier,
      paymentMethod
    };
  }

  _handleUserAccept(details: {
    transactionIdentifier: string,
    paymentData: string,
    shippingAddress: PaymentAddress | null,
    payerEmail: string,
    paymentToken?: string,
    paymentMethod: Object
  }) {
    // On Android, we don't have `onShippingAddressChange` events, so we
    // set the shipping address when the user accepts.
    // Developers will only have access to it in the `PaymentResponse`.
    if (IS_ANDROID) {
      const { shippingAddress } = details;
      this._shippingAddress = shippingAddress;
    }

    const paymentResponse = new PaymentResponse({
      requestId: this.id,
      methodName: IS_IOS ? 'apple-pay' : 'android-pay',
      shippingAddress: this._options.requestShipping
        ? this._shippingAddress
        : null,
      details: this._getPlatformDetails(details),
      shippingOption: IS_IOS ? this._shippingOption ?? null : null,
      payerName: this._options.requestPayerName ? this._shippingAddress?.recipient ?? null : null,
      payerPhone: this._options.requestPayerPhone ? this._shippingAddress?.phone ?? null : null,
      payerEmail: IS_ANDROID && this._options.requestPayerEmail
        ? details.payerEmail
        : null
    });

    return this._acceptPromiseResolver?.(paymentResponse);
  }

  _closePaymentRequest(reject = true) {
    this._state = 'closed';

    if (reject) this._acceptPromiseRejecter?.(new Error('AbortError'));

    this._removeEventListeners();
  }

  _removeEventListeners() {
    this._userDismissSubscription?.remove();
    this._userAcceptSubscription?.remove();

    if (IS_IOS) {
      this._shippingAddressChangeSubscription?.remove();
      this._shippingOptionChangeSubscription?.remove();
    }
  }

  stopRequest() {
    if (this._state !== 'closed') this._closePaymentRequest(false);
  }

  // https://www.w3.org/TR/payment-request/#onshippingaddresschange-attribute
  // https://www.w3.org/TR/payment-request/#onshippingoptionchange-attribute
  addEventListener(
    eventName: 'shippingaddresschange' | 'shippingoptionchange',
    fn: any,
  ) {
    if (eventName === SHIPPING_ADDRESS_CHANGE_EVENT) {
      return (this._shippingAddressChangeFn = fn.bind(this));
    }

    if (eventName === SHIPPING_OPTION_CHANGE_EVENT) {
      return (this._shippingOptionChangeFn = fn.bind(this));
    }
  }

  // https://www.w3.org/TR/payment-request/#id-attribute
  get id(): string {
    return this._id;
  }

  // https://www.w3.org/TR/payment-request/#shippingaddress-attribute
  get shippingAddress(): null | PaymentAddress {
    return this._shippingAddress;
  }

  // https://www.w3.org/TR/payment-request/#shippingoption-attribute
  get shippingOption(): null | string {
    return this._shippingOption;
  }

  // https://www.w3.org/TR/payment-request/#show-method
  show(): Promise<PaymentResponseType> {
    return new Promise((resolve, reject) => {
      this._acceptPromiseResolver = resolve;
      this._acceptPromiseRejecter = reject;

      if (this._state !== 'created') {
        return reject(new Error('InvalidStateError'));
      }

      this._state = 'interactive';

      // These arguments are passed because on Android we don't call createPaymentRequest.
      const platformMethodData = getPlatformMethodData(
        JSON.parse(this._serializedMethodData),
        Platform.OS
      );
      const normalizedDetails = convertDetailAmountsToString(this._details);
      const options = this._options;

      // Note: resolve will be triggered via _acceptPromiseResolver() from somwhere else
      NativePayments.show(platformMethodData, normalizedDetails, options).catch(
        reject
      );
    });
  }

  // https://www.w3.org/TR/payment-request/#abort-method
  async abort(): Promise<void> {
    if (this._state !== 'interactive') {
      throw new Error('InvalidStateError');
    }

    try {
      await NativePayments.abort()
      this._closePaymentRequest();
    } catch (error) {
      throw new Error('InvalidStateError')
    }
  }

  // https://www.w3.org/TR/payment-request/#canmakepayment-method
  canMakePayments(): Promise<boolean> {
    return NativePayments.canMakePayments(
      getPlatformMethodData(JSON.parse(this._serializedMethodData), Platform.OS)
    );
  }
}
