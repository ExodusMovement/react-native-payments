import { DeviceEventEmitter, EmitterSubscription, Platform } from 'react-native';
import { randomUUID } from '@exodus/crypto/randomUUID';

import type PaymentResponseType from './PaymentResponse';
import NativePayments from './NativePayments';
import PaymentResponse from './PaymentResponse';
import PaymentRequestUpdateEvent from './PaymentRequestUpdateEvent';
import { ConstructorError } from './errors';

import {
  convertDetailAmountsToString,
  getPlatformMethodData,
  validateTotal,
  validatePaymentMethods,
  validateDisplayItems,
  validateShippingOptions,
  getSelectedShippingOption,
} from './helpers';

import type {
  PaymentMethodData,
  PaymentDetailsInit,
  PaymentOptions,
  PaymentAddress,
  PaymentShippingType,
  PaymentDetailsIOS,
  PaymentDetailsIOSRaw
} from './types';

import {
  SHIPPING_ADDRESS_CHANGE_EVENT,
  SHIPPING_OPTION_CHANGE_EVENT,
  INTERNAL_SHIPPING_ADDRESS_CHANGE_EVENT,
  INTERNAL_SHIPPING_OPTION_CHANGE_EVENT,
  USER_DISMISS_EVENT,
  USER_ACCEPT_EVENT,
} from './constants';

const noop = () => {};
const IS_ANDROID = Platform.OS === 'android';
const IS_IOS = Platform.OS === 'ios';

export default class PaymentRequest {
  id: string;
  shippingAddress: null | PaymentAddress;
  shippingOption: null | string;
  shippingType: null | PaymentShippingType;

  _serializedMethodData: string;
  _details: PaymentDetailsInit;
  _options: Object;
  _state: 'created' | 'interactive' | 'closed';
  _updating: boolean;
  _acceptPromise?: Promise<any>;
  _shippingAddressChangesCount: number;

  _acceptPromiseResolver?: (value: any) => void;
  _acceptPromiseRejecter?: (reason: any) => void;
  _shippingAddressChangeFn?: (event: PaymentRequestUpdateEvent) => void; // function provided by user
  _shippingOptionChangeFn?: (event: PaymentRequestUpdateEvent) => void; // function provided by user

  _shippingAddressChangeSubscription?: EmitterSubscription;
  _shippingOptionChangeSubscription?: EmitterSubscription;
  _userDismissSubscription?: EmitterSubscription;
  _userAcceptSubscription?: EmitterSubscription;

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


    if (options.merchantCapabilities) {
      options.merchantCapabilities = options.merchantCapabilities.reduce(
        (capabilitiesMap, capability) => {
          capabilitiesMap[capability] = true;
          return capabilitiesMap;
        },
        {}
      );
    }

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

    // TODO: Look into how payment details modifiers are used.
    // 10. Process payment details modifiers:
    // processPaymentDetailsModifiers(details, serializedModifierData)

    // 11. Let request be a new PaymentRequest.

    // 12. Set request.[[options]] to options.
    this._options = options;

    // 13. Set request.[[state]] to "created".
    this._state = 'created';

    // 14. Set request.[[updating]] to false.
    this._updating = false;

    // 15. Set request.[[details]] to details.
    this._details = details;

    // 16. Set request.[[serializedModifierData]] to serializedModifierData.
    // this._serializedModifierData = [];

    // 17. Set request.[[serializedMethodData]] to serializedMethodData.
    this._serializedMethodData = JSON.stringify(methodData);

    // Set attributes (18-20)
    this.id = details.id;

    // 18. Set the value of request's shippingOption attribute to selectedShippingOption.
    this.shippingOption = selectedShippingOption;

    // 19. Set the value of the shippingAddress attribute on request to null.
    this.shippingAddress = null;

    // 20. If options.requestShipping is set to true, then set the value of the shippingType attribute on request to options.shippingType. Otherwise, set it to null.
    this.shippingType =
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
    // Internal Events
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
    this.shippingAddress = postalAddress;

    const event = new PaymentRequestUpdateEvent(
      SHIPPING_ADDRESS_CHANGE_EVENT,
      this
    );
    this._shippingAddressChangesCount++;

    // On iOS, this event fires when the PKPaymentRequest is initialized.
    // So on iOS, we track the amount of times `_handleShippingAddressChange` gets called
    // and noop the first call.
    if (IS_IOS && this._shippingAddressChangesCount === 1) {
      return event.updateWith(this._details);
    }

    // Eventually calls `PaymentRequestUpdateEvent._handleDetailsUpdate` when
    // after a details are returned
    this._shippingAddressChangeFn?.(event);
  }

  _handleShippingOptionChange(value: { selectedShippingOptionId: string }) {
    // Update the `shippingOption`
    this.shippingOption = value.selectedShippingOptionId;

    const event = new PaymentRequestUpdateEvent(
      SHIPPING_OPTION_CHANGE_EVENT,
      this
    );

    this._shippingOptionChangeFn?.(event);
  }

  //  _getPlatformDetailsAndroid(
  //   details: {
  //   googleTransactionId: string,
  //   payerEmail: string,
  //   paymentDescription: string,
  //   shippingAddress: Object
  //   }
  // ) {
  //   const { googleTransactionId, paymentDescription } = details;

  //   return {
  //   googleTransactionId,
  //   paymentDescription,
  //   // On Android, the recommended flow is to have user's confirm prior to
  //   // retrieving the full wallet.
  //   getPaymentToken: () =>
  //     NativePayments.getFullWalletAndroid(
  //       googleTransactionId,
  //       getPlatformMethodData(
  //         JSON.parse(this._serializedMethodData, Platform.OS)
  //       ),
  //       convertDetailAmountsToString(this._details)
  //     )
  //   };
  // }

  _getPlatformDetails(details: PaymentDetailsIOSRaw): PaymentDetailsIOS {
    if (!IS_IOS) throw new Error('Not implemented');

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
    //
    // Developers will only have access to it in the `PaymentResponse`.
    if (IS_ANDROID) {
      const { shippingAddress } = details;
      this.shippingAddress = shippingAddress;
    }

    const paymentResponse = new PaymentResponse({
      requestId: this.id,
      methodName: IS_IOS ? 'apple-pay' : 'android-pay',
      shippingAddress: this._options.requestShipping
        ? this.shippingAddress
        : null,
      details: this._getPlatformDetails(details),
      shippingOption: IS_IOS ? this.shippingOption : null
      // payerName: this._options.requestPayerName ? this._shippingAddress.recipient : null,
      // payerPhone: this._options.requestPayerPhone ? this._shippingAddress.phone : null,
      // payerEmail: IS_ANDROID && this._options.requestPayerEmail
      //   ? details.payerEmail
      //   : null
    });

    return this._acceptPromiseResolver?.(paymentResponse);
  }

  _closePaymentRequest(reject = true) {
    this._state = 'closed';

    if (reject) this._acceptPromiseRejecter?.(new Error('AbortError'));

    // Remove event listeners before aborting.
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
    fn: any
  ) {
    if (eventName === SHIPPING_ADDRESS_CHANGE_EVENT) {
      return (this._shippingAddressChangeFn = fn.bind(this));
    }

    if (eventName === SHIPPING_OPTION_CHANGE_EVENT) {
      return (this._shippingOptionChangeFn = fn.bind(this));
    }
  }

  // https://www.w3.org/TR/payment-request/#canmakepayment-method
  canMakePayments() {
    return NativePayments.canMakePayments(
      getPlatformMethodData(JSON.parse(this._serializedMethodData), Platform.OS)
    );
  }

  // https://www.w3.org/TR/payment-request/#show-method
  show(): Promise<PaymentResponseType> {
    this._acceptPromise = new Promise((resolve, reject) => {
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

    return this._acceptPromise;
  }

  // https://www.w3.org/TR/payment-request/#abort-method
  async abort(): Promise<void> {
    // We can't abort if the PaymentRequest isn't shown or already closed
    if (this._state !== 'interactive') {
      throw new Error('InvalidStateError');
    }

    // Try to dismiss the UI
    try {
      await NativePayments.abort()
        this._closePaymentRequest();

    } catch (error) {
      new Error('InvalidStateError')
    }
  }
}
