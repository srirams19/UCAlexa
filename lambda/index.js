/* 
* This is a skill that lets users schedule an appointment with the WellStreet Urgent Care Centers listed below.
* Users can choose a date and time to book an appointment that is then confirmed by WellStreet appointment booking system.
* This skill uses the Digital Front Door Check Availability and Book Appointment APIs for the same.
* This skill asks users for basic details such as center to visit, type of appointment, payment options.
* This skill uses the ASK SDK 2.0 demonstrates the use of dialogs, getting a users email, name,
* and mobile phone fro the the settings api, along with confirmation the appointment date time back to the user.
*/

const Alexa = require('ask-sdk-core');
const AWS = require('aws-sdk');
const dotenv = require('dotenv');
const i18n = require('i18next');
const sprintf = require('i18next-sprintf-postprocessor');
const luxon = require('luxon');
const ics = require('ics');
const { google } = require('googleapis');
const sgMail = require('@sendgrid/mail');
const https = require('https');
require('dotenv').config();

/* CENTER LISTS */
let centerLists = require('./centers');

/* CONSTANTS */
// To set constants, change the value in .env.sample then

/* LANGUAGE STRINGS */
const languageStrings = require('./languages/languageStrings');

/* HANDLERS */
// This handler responds when required environment variables
// missing or a .env file has not been created.
const InvalidConfigHandler = {
  canHandle(handlerInput) {
    const attributes = handlerInput.attributesManager.getRequestAttributes();

    const invalidConfig = attributes.invalidConfig || false;

    return invalidConfig;
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    const speakOutput = requestAttributes.t('ENV_NOT_CONFIGURED');

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .getResponse();
  },
};

// This is a handler that is used when the user has not enabled the
// required permissions.
const InvalidPermissionsHandler = {
  canHandle(handlerInput) {
    const attributes = handlerInput.attributesManager.getRequestAttributes();

    return attributes.permissionsError;
  },
  handle(handlerInput) {
    const attributes = handlerInput.attributesManager.getRequestAttributes();

    switch (attributes.permissionsError) {
      case 'no_name':
        return handlerInput.responseBuilder
          .speak(attributes.t('NAME_REQUIRED'))
          .withSimpleCard(attributes.t('SKILL_NAME'), attributes.t('NAME_REQUIRED_REPROMPT'))
          .getResponse();
      case 'no_email':
        return handlerInput.responseBuilder
          .speak(attributes.t('EMAIL_REQUIRED'))
          .withSimpleCard(attributes.t('SKILL_NAME'), attributes.t('EMAIL_REQUIRED_REPROMPT'))
          .getResponse();
      case 'no_phone':
        return handlerInput.responseBuilder
          .speak(attributes.t('PHONE_REQUIRED'))
          .withSimpleCard(attributes.t('SKILL_NAME'), attributes.t('PHONE_REQUIRED_REPROMPT'))
          .getResponse();
      case 'permissions_required':
        return handlerInput.responseBuilder
          .speak(attributes.t('PERMISSIONS_REQUIRED', attributes.t('SKILL_NAME')))
          .withAskForPermissionsConsentCard(['alexa::profile:email:read', 'alexa::profile:name:read', 'alexa::profile:mobile_number:read'])
          .getResponse();
      default:
        // throw an error if the permission is not defined
        throw new Error(`${attributes.permissionsError} is not a known permission`);
    }
  },
};

// This is a handler that is launched to greet the user if the required permissions are enabled.
const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    
    const speakOutput = requestAttributes.t('GREETING', requestAttributes.t('SKILL_NAME'));
    const repromptOutput = requestAttributes.t('GREETING_REPROMPT');
    
    console.log("Inside LaunchRequestHandler");

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .withShouldEndSession(false)
      .reprompt(repromptOutput)
      .getResponse();
  },
};

// This handler is used to handle 'yes' utternaces
const YesIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.YesIntent';
  },
  handle(handlerInput) {
    console.log("Inside YesIntentHandler " + handlerInput.requestEnvelope.request.intent.name);

    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const slotToBook = sessionAttributes.slotToBook;
    console.log("slotToBook value is " + slotToBook);
    let handlerName;
    let speakOutput;

    if (typeof slotToBook === 'undefined' || slotToBook === null) {
        handlerName = 'CheckAvailabilityIntent';
        speakOutput = requestAttributes.t('SCHEDULE_YES');
    } else if (slotToBook === 'NONE') {
        handlerName = 'CheckAvailabilityIntent';
        speakOutput = requestAttributes.t('SCHEDULE_YES');
    } else {
        handlerName = 'ScheduleAppointmentIntent';
        speakOutput = requestAttributes.t('SCHEDULE_YES_CONFIRMATION');
    }
    console.log("handlerName is " + handlerName);
    
    return handlerInput.responseBuilder
      .addDelegateDirective({
        name: handlerName,
        confirmationStatus: 'NONE',
        slots: {},
      })
      .speak(speakOutput)
      .getResponse();
  },
};

// This is a handler that is used to initiate the schedule appointment intent.
const StartedInProgressScheduleAppointmentIntentHandler = {
  canHandle(handlerInput) {
    const { request } = handlerInput.requestEnvelope;
    return request.type === 'IntentRequest'
      && request.intent.name === 'ScheduleAppointmentIntent'
      && request.dialogState !== 'COMPLETED';
  },
  async handle(handlerInput) {
    const currentIntent = handlerInput.requestEnvelope.request.intent;
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const upsServiceClient = handlerInput.serviceClientFactory.getUpsServiceClient();

    // get timezone
    const { deviceId } = handlerInput.requestEnvelope.context.System.device;
    const userTimezone = await upsServiceClient.getSystemTimeZone(deviceId);

    // get slots
    const appointmentDateTime = sessionAttributes.slotToBook;
    const appointmentClinic = sessionAttributes.appointmentClinic;
    const centerId = sessionAttributes.centerId;
    const appointmentReason = currentIntent.slots.appointmentReason;
    const appointmentSymptoms = currentIntent.slots.appointmentSymptoms;
    const appointmentInsurance = currentIntent.slots.appointmentInsurance;
    const profileDateOfBirth = currentIntent.slots.profileDateOfBirth;
    const profileName = await upsServiceClient.getProfileName();

    // we have an appointment date and time
    if (appointmentDateTime && appointmentClinic && appointmentReason.value && appointmentSymptoms.value && appointmentInsurance.value && profileDateOfBirth.value) {
        const speakDateTimeLocal = luxon.DateTime.fromISO(appointmentDateTime).setZone(process.env.DFD_TIMEZONE).toLocaleString(luxon.DateTime.DATETIME_HUGE);

      // custom intent confirmation for ScheduleAppointmentIntent
      if (currentIntent.confirmationStatus === 'NONE'
        && currentIntent.slots.appointmentReason.value
        && currentIntent.slots.appointmentSymptoms.value
        && currentIntent.slots.appointmentInsurance.value
        && currentIntent.slots.profileDateOfBirth.value) {
        const speakOutput = requestAttributes.t('APPOINTMENT_CONFIRM', profileName, speakDateTimeLocal, appointmentClinic);
        const repromptOutput = requestAttributes.t('APPOINTMENT_CONFIRM_REPROMPT', speakDateTimeLocal);

        return handlerInput.responseBuilder
          .speak(speakOutput)
          .reprompt(repromptOutput)
          .addConfirmIntentDirective()
          .getResponse();
      }
    }

    return handlerInput.responseBuilder
      .addDelegateDirective(currentIntent)
      .getResponse();
  },
};

// Handles the completion of an appointment. This handler is used when
// dialog in ScheduleAppointmentIntent is completed.
const CompletedScheduleAppointmentIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'ScheduleAppointmentIntent'
      && handlerInput.requestEnvelope.request.dialogState === 'COMPLETED';
  },
  async handle(handlerInput) {
    const currentIntent = handlerInput.requestEnvelope.request.intent;
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const upsServiceClient = handlerInput.serviceClientFactory.getUpsServiceClient();

    // get timezone
    const { deviceId } = handlerInput.requestEnvelope.context.System.device;
    const userTimezone = await upsServiceClient.getSystemTimeZone(deviceId);

    // get slots
    const appointmentDate = sessionAttributes.appointmentDate;
    const startTimeInMins = sessionAttributes.startTimeInMins;
    const endTimeInMins = sessionAttributes.endTimeInMins;
    const slotQueue = sessionAttributes.slotQueue;
    const appointmentClinic = sessionAttributes.appointmentClinic;
    const slotToBook = sessionAttributes.slotToBook;
    const centerId = sessionAttributes.centerId;
    const appointmentReason = currentIntent.slots.appointmentReason;
    const appointmentSymptoms = currentIntent.slots.appointmentSymptoms;
    const appointmentInsurance = currentIntent.slots.appointmentInsurance;
    let profileDateOfBirth = currentIntent.slots.profileDateOfBirth;
    //console.log("CompletedScheduleAppointmentIntentHandler profileDateOfBirth -->" + profileDateOfBirth.value);
    const dateOfBirth = profileDateOfBirth.value + process.env.DFD_TIMESTAMP_HOLDER;
    //console.log("CompletedScheduleAppointmentIntentHandler dateOfBirth -->" + dateOfBirth);

    
    const speakDateTimeLocal = luxon.DateTime.fromISO(slotToBook).setZone(process.env.DFD_TIMEZONE).toLocaleString(luxon.DateTime.DATETIME_HUGE);

    // get user profile details
    const mobileNumber = await upsServiceClient.getProfileMobileNumber();
    const profileName = await upsServiceClient.getProfileName();
    const profileEmail = await upsServiceClient.getProfileEmail();
    
    //get first name and last name
    var profileArray = profileName.split(/\s+/);
    console.log("split profile name is " + profileArray);
    const firstName = profileArray[0];
    console.log("first name is " + firstName);
    const lastName = profileArray[1];
    console.log("last name is " + lastName);
     
    // deal with intent confirmation denied
    if (currentIntent.confirmationStatus === 'DENIED') {
      const speakOutput = requestAttributes.t('NO_CONFIRM');
      const repromptOutput = requestAttributes.t('NO_CONFIRM_REPROMPT');

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt(repromptOutput)
        .getResponse();
    }

    // params for booking appointment
    const appointmentData = {
	    operationName: "createVisitPa",
	    variables: {
		"createVisitobj": {
			"otpVerified": true,
			"reason": appointmentReason.value,
			"symptoms": appointmentSymptoms.value,
			"checkinLocation": process.env.DFD_CHECK_IN_LOCATION,
			//Home, Parking Lot, Inside Clinic
			"firstName": firstName,
			"lastName": lastName,
			"dateOfBirth": dateOfBirth,
			"phoneNumber": "+1" + mobileNumber.phoneNumber,
			"consentToSMSNotification": true,
			"payment": {
				"type": appointmentInsurance.value
			},
			"verificationInfo": {
				"id": process.env.DFD_DUMMY_VERIFICATION_ID,
				"code": 984237
			},
			"appointment": {
				"date": appointmentDate,
				"startTimeInMins": startTimeInMins,
				"endTimeInMins": endTimeInMins,
				"slotQueue": slotQueue
			},
			"centerId": centerId,
			"requestFromEmployerApp": false,
			"iAmHere": false,
			"channel": process.env.DFD_CHANNEL,
			"isTelemedVisit": false,
			"isPatientChoseFirstSlot": true,
			"nextAvailable": {
				"startTimeInMins": 720,
				"endTimeInMins": 780,
				"date": process.env.DFD_DUMMY_DATE1
			}
		},
		date: process.env.DFD_DUMMY_DATE2
	    },
	    query: "mutation createVisitPa($createVisitobj: CreateVisitInput!, $date: DateTime!) {\n  createVisitPa(createVisit: $createVisitobj, date: $date) {\n    _id\n    centerInfo {\n      centerId\n      facilityName\n      providerName\n      address {\n        address1\n        city\n        state\n        zipcode\n        coordinates\n        __typename\n      }\n      __typename\n    }\n    email\n    phoneNumber\n    createdDateTime\n    updatedDateTime\n    appointment {\n      date\n      startTimeInMins\n      endTimeInMins\n      slotQueue\n      __typename\n    }\n    reason\n    currentStatusCode\n    currentSubStatusCode\n    consentToSMSNotification\n    isNewVisit\n    patientInfo {\n      patientId\n      firstName\n      lastName\n      middleName\n      preferredName\n      dateOfBirth\n      sex\n      language\n      isMarried\n      ethnicity\n      race\n      preferredPharmacy {\n        name\n        address\n        __typename\n      }\n      __typename\n    }\n    photoIdUri {\n      front {\n        name\n        uri\n        previewBase64\n        __typename\n      }\n      back {\n        name\n        uri\n        previewBase64\n        __typename\n      }\n      __typename\n    }\n    contactDetails {\n      phoneNumber\n      email\n      address1\n      address2\n      city\n      state\n      zipCode\n      __typename\n    }\n    primaryCare {\n      care\n      physician\n      phone\n      __typename\n    }\n    emergencyContact {\n      name\n      phone\n      relationship\n      otherRelationship\n      __typename\n    }\n    responsibleParty {\n      relationshipToSubscriber\n      firstName\n      lastName\n      dateOfBirth\n      email\n      phone\n      __typename\n    }\n    priority\n    previousPriority\n    secondaryInsuranceInfo {\n      isSecondaryAvailable\n      ssn\n      insuranceCompany\n      insuranceCoverageType\n      memberId\n      groupNumber\n      insuranceIdUri {\n        front {\n          name\n          uri\n          previewBase64\n          __typename\n        }\n        back {\n          name\n          uri\n          previewBase64\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    insuranceInfo {\n      ssn\n      insuranceCompany\n      insuranceCoverageType\n      memberId\n      groupNumber\n      insuranceIdUri {\n        front {\n          name\n          uri\n          previewBase64\n          __typename\n        }\n        back {\n          name\n          uri\n          previewBase64\n          __typename\n        }\n        __typename\n      }\n      secondaryInsurance\n      vaNotified\n      __typename\n    }\n    idMismatchInfo\n    insuranceMismatchInfo\n    registrationChecks {\n      identity\n      forms\n      insurance\n      medicare\n      patientDetails\n      contactDetails\n      insuranceDetails\n      medicare\n      insuranceHolder\n      financialResponsibility\n      condOfServAndConsentToTreat\n      patientFinancialResponsibility\n      authToReleaseInfo\n      ackOfRightsAndPrivacy\n      medicalRecordDiscloser\n      childProxyForm\n      childProxyConsent\n      occMedRegistrationStatus\n      occMedPatientDetails\n      occMedCompanyInformation\n      workRelatedInjuryForm\n      patientConsentForm\n      __typename\n    }\n    occMed {\n      haveWorkInjury\n      driversLicenseClass\n      patientID\n      license\n      stateIssue\n      driversLicenseClass\n      driversLicenseIdUri {\n        front {\n          name\n          uri\n          previewBase64\n          __typename\n        }\n        __typename\n      }\n      passport\n      countryIssue\n      passportIdUploadUri {\n        front {\n          name\n          uri\n          previewBase64\n          __typename\n        }\n        __typename\n      }\n      authorizationLetterUri {\n        front {\n          name\n          uri\n          previewBase64\n          __typename\n        }\n        __typename\n      }\n      companyName\n      companyPhone\n      bodyPartOfInjury\n      priorInjuriesDate\n      comments\n      dateTimeOfInjury\n      priorInjuries\n      priorInjuriesReason\n      reasonForInjury\n      consentToPrivacy\n      patientAgreement\n      signature\n      signedDateForAgreement\n      __typename\n    }\n    isAttended\n    iAmHere\n    attendedBy\n    visitType\n    isOccMedVisit\n    employeeServiceType\n    subscriberInfo {\n      firstName\n      lastName\n      dateOfBirth\n      relationship\n      ssn\n      relationshipOther\n      __typename\n    }\n    isConsentAgreed\n    workflow {\n      timeStamp\n      actionTakenBy\n      workflowStatusCode\n      workflowSubStatuscode\n      __typename\n    }\n    notes {\n      comments\n      timeStamp\n      notesBy\n      hasNew\n      __typename\n    }\n    financialSignature\n    autorizationToReleaseSignature\n    payment {\n      _id\n      type\n      __typename\n    }\n    employer {\n      employer\n      contactName\n      contactPhoneNumber\n      address1\n      address2\n      city\n      state\n      zipCode\n      reason\n      __typename\n    }\n    medicare {\n      isMedicareAvailable\n      firstName\n      lastName\n      middleName\n      preferredName\n      dateOfBirth\n      ssn\n      blackLungBenefits\n      paidByGovernment\n      benefitsThroughDVA\n      illnessDueToWork\n      illnessDueToNonWork\n      medicareBasedOnAge\n      medicareBasedOnDiability\n      esrd\n      employed\n      dateOfRetirement\n      yourSpouseEmployed\n      spouseDateOfRetirement\n      ghpCoverage\n      __typename\n    }\n    consentToTreat\n    rightAndPrivacy {\n      firstName\n      consentTOPrivacy\n      signature\n      __typename\n    }\n    consent {\n      consentToTreat\n      consentToFinanicalResposibity\n      consentToReleaseInformation\n      consentToChildProxy\n      consentToPrivacy\n      consentToTeleMedicine\n      __typename\n    }\n    childProxyForm {\n      firstName\n      lastName\n      middleName\n      preferredName\n      dateOfBirth\n      phoneNumber\n      email\n      address1\n      address2\n      state\n      city\n      zipCode\n      primaryClinic\n      __typename\n    }\n    childProxyConsent {\n      firstName\n      consentToChart\n      signature\n      __typename\n    }\n    medicalRecordDiscloser {\n      relationship\n      relationshipOther\n      firstName\n      lastName\n      phoneNumber\n      __typename\n    }\n    iAmHere\n    currentStatusCode\n    symptoms\n    __typename\n  }\n}\n"
    };

    sessionAttributes.appointmentData = appointmentData;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
    
    console.log("before calling bookAppointment" + handlerInput.attributesManager.getSessionAttributes().appointmentData.operationName);
    
    await bookAppointment(handlerInput);

    const speakOutput = requestAttributes.t('APPOINTMENT_CONFIRM_COMPLETED', speakDateTimeLocal, appointmentClinic);

    return handlerInput.responseBuilder
        .withSimpleCard(
          requestAttributes.t('APPOINTMENT_TITLE', process.env.FROM_NAME),
          requestAttributes.t('APPOINTMENT_CONFIRM_COMPLETED', speakDateTimeLocal,appointmentClinic),
        )
        .speak(speakOutput)
        .getResponse();
  },
};



// This handler is used to handle cases when a user asks if an
// appointment time is available
const CheckAvailabilityIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'CheckAvailabilityIntent';
  },
  async handle(handlerInput) {
    const {
      responseBuilder,
      attributesManager,
    } = handlerInput;

    const currentIntent = handlerInput.requestEnvelope.request.intent;
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();

    // get slots
    const appointmentDate = currentIntent.slots.appointmentDate;
    const appointmentClinic = currentIntent.slots.appointmentClinic;
    var todayOrTomorrow = 'today';
    
    // format appointment date and time
    var dateLocal = luxon.DateTime.now().setZone('America/New_York').startOf('day');
    var dateLocalFormatted = dateLocal.toISO();
    console.log("Today's dateformat  is " + dateLocalFormatted);
    
    //console.log("Today's date  is " + dateLocal);
     if (appointmentDate !== 'undefined' && (appointmentDate.value === 'tomorrow' || appointmentDate.value === 'tommorrow')) {
          dateLocal = dateLocal.plus({days: 1});
          todayOrTomorrow = 'tomorrow';
          dateLocalFormatted = dateLocal.toISO();
          console.log("Tomorrow's date  is " + dateLocalFormatted);
     }
    
    let startTimeInMins;
    
    const centerId = centerLists[appointmentClinic.value.toUpperCase()];

    console.log("center name is " + appointmentClinic.value + " center code is " + centerId);
    sessionAttributes.centerId = centerId;
    sessionAttributes.appointmentClinic = appointmentClinic.value;

    // get the list of available slots for this center and appointmentDate
    let slotAvailabilityResponse = checkAvailability(centerId, dateLocalFormatted, handlerInput);
    
    slotAvailabilityResponse.then((myResponse) => { 
        console.log("Response Data is " + myResponse);
        const responseData = JSON.parse(myResponse);
        console.log("Parsed Response Data is " + responseData);
        if (responseData !== 'undefined' && responseData.data !== null) {
            console.log("getAvailableSlots response received is " + responseData.data);
            let appointmentDate;
            let startTimeInMins;
            let endTimeInMins;
            let totalSlots;
            let usedSlots;
            let offlineSlots;
            let onlineSlots;
            let usedOfflineSlots;
            let usedOnlineSlots;
            let availableSlots;
            let availableOnlineSlots;

            if (todayOrTomorrow !== 'undefined' && todayOrTomorrow === 'today') {
                if (responseData.data.getAvailableSlots.nextSlotForToday !== null) {
                    console.log("nextSlotForToday ");

                    appointmentDate = responseData.data.getAvailableSlots.nextSlotForToday.date;
                    startTimeInMins = responseData.data.getAvailableSlots.nextSlotForToday.startTimeInMins;
                    endTimeInMins = responseData.data.getAvailableSlots.nextSlotForToday.endTimeInMins;
                    totalSlots = responseData.data.getAvailableSlots.nextSlotForToday.totalSlots;
                    usedSlots = responseData.data.getAvailableSlots.nextSlotForToday.usedSlots;
                    offlineSlots = responseData.data.getAvailableSlots.nextSlotForToday.offlineSlots;
                    onlineSlots = responseData.data.getAvailableSlots.nextSlotForToday.onlineSlots;
                    usedOfflineSlots = responseData.data.getAvailableSlots.nextSlotForToday.usedOfflineSlots;
                    usedOnlineSlots = responseData.data.getAvailableSlots.nextSlotForToday.usedOnlineSlots;
                    availableSlots = responseData.data.getAvailableSlots.nextSlotForToday.availableSlots;
                    availableOnlineSlots = onlineSlots - usedOnlineSlots;
                }
                
                //check for other slots for today
                else if (responseData.data.getAvailableSlots.otherSlotForToday === null || responseData.data.getAvailableSlots.otherSlotForToday.length === 0) {
                    console.log("No slots for today ");

                    let speakOutput = requestAttributes.t('NO_SLOT_AVAILABLE', "today", "tomorrow");
                    let speekReprompt = requestAttributes.t('NO_SLOT_AVAILABLE', "today", "tomorrow");
                    
                    sessionAttributes.slotToBook = "NONE";
                    sessionAttributes.todayOrTomorrow = todayOrTomorrow;
                    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

                
                    return responseBuilder
                        .speak(speakOutput)
                        .reprompt(speekReprompt)
                        .getResponse();
    
                } 
                else {
                    console.log("otherSlotForToday ");

                    appointmentDate = responseData.data.getAvailableSlots.otherSlotForToday[0].date;
                    startTimeInMins = responseData.data.getAvailableSlots.otherSlotForToday[0].startTimeInMins;
                    endTimeInMins = responseData.data.getAvailableSlots.otherSlotForToday[0].endTimeInMins;
                    totalSlots = responseData.data.getAvailableSlots.otherSlotForToday[0].totalSlots;
                    usedSlots = responseData.data.getAvailableSlots.otherSlotForToday[0].usedSlots;
                    offlineSlots = responseData.data.getAvailableSlots.otherSlotForToday[0].offlineSlots;
                    onlineSlots = responseData.data.getAvailableSlots.otherSlotForToday[0].onlineSlots;
                    usedOfflineSlots = responseData.data.getAvailableSlots.otherSlotForToday[0].usedOfflineSlots;
                    usedOnlineSlots = responseData.data.getAvailableSlots.otherSlotForToday[0].usedOnlineSlots;
                    availableSlots = responseData.data.getAvailableSlots.otherSlotForToday[0].availableSlots;
                    availableOnlineSlots = onlineSlots - usedOnlineSlots;    
                }
            }

            if (todayOrTomorrow !== 'undefined' && todayOrTomorrow === 'tomorrow') {
                 if (responseData.data.getAvailableSlots.otherSlotForTomorrow === null || responseData.data.getAvailableSlots.otherSlotForTomorrow.length === 0) {
                    console.log("No slots for tomorrow ");

                    let speakOutput = requestAttributes.t('NO_SLOT_AVAILABLE', "tomorrow", "today");
                    let speekReprompt = requestAttributes.t('NO_SLOT_AVAILABLE', "tomorrow", "today");
                    
                    sessionAttributes.slotToBook = "NONE";
                    sessionAttributes.todayOrTomorrow = todayOrTomorrow;
                    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

                
                    return responseBuilder
                        .speak(speakOutput)
                        .reprompt(speekReprompt)
                        .getResponse();
                 } else {
                    console.log("otherSlotForTomorrow" + responseData.data.getAvailableSlots.otherSlotForTomorrow[0]);

                    appointmentDate = responseData.data.getAvailableSlots.otherSlotForTomorrow[0].date;
                    startTimeInMins = responseData.data.getAvailableSlots.otherSlotForTomorrow[0].startTimeInMins;
                    endTimeInMins = responseData.data.getAvailableSlots.otherSlotForTomorrow[0].endTimeInMins;
                    totalSlots = responseData.data.getAvailableSlots.otherSlotForTomorrow[0].totalSlots;
                    usedSlots = responseData.data.getAvailableSlots.otherSlotForTomorrow[0].usedSlots;
                    offlineSlots = responseData.data.getAvailableSlots.otherSlotForTomorrow[0].offlineSlots;
                    onlineSlots = responseData.data.getAvailableSlots.otherSlotForTomorrow[0].onlineSlots;
                    usedOfflineSlots = responseData.data.getAvailableSlots.otherSlotForTomorrow[0].usedOfflineSlots;
                    usedOnlineSlots = responseData.data.getAvailableSlots.otherSlotForTomorrow[0].usedOnlineSlots;
                    availableSlots = responseData.data.getAvailableSlots.otherSlotForTomorrow[0].availableSlots;
                    availableOnlineSlots = onlineSlots - usedOnlineSlots;
                }
            }
                
                console.log("appointmentDate " + appointmentDate);
                console.log("startTimeInMins " + startTimeInMins);
                console.log("endTimeInMins " + endTimeInMins);
                console.log("totalSlots " + totalSlots);
                console.log("usedSlots " + usedSlots);
                console.log("offlineSlots " + offlineSlots);
                console.log("onlineSlots " + onlineSlots);
                console.log("usedOfflineSlots " + usedOfflineSlots);
                console.log("usedOnlineSlots " + usedOnlineSlots);
                console.log("availableSlots " + availableSlots);
                console.log("availableOnlineSlots " + availableOnlineSlots);
                
                let slotQueue;
                if (availableOnlineSlots > 0) {
                    if (usedSlots.length < 1) {
                        slotQueue = 1;
                        console.log("slotQueue is 1");
                        var minuteLocalCheck = Math.round(60/totalSlots)*slotQueue;
                        var dateLocalCheck = dateLocal;
                        var dateTimeLocalCheck = dateLocalCheck.plus({'minute': startTimeInMins+minuteLocalCheck});
                        const diff = luxon.Interval.fromDateTimes(dateTimeLocalCheck, luxon.DateTime.now());
                        const diffHours = diff.length('minutes');
                        if (diffHours > 0) {
                            dateTimeLocalCheck = dateLocalCheck.plus({'minute': startTimeInMins+diffHours});
                            console.log("dateTimeLocalCheck is " + dateTimeLocalCheck);
                        }
                        console.log("diffHours is " + diffHours);
                    } else {
                        for (let step =0; step < usedSlots.length; step++) {
                            console.log("slotQueue loop " + step);

                            if (step++ !== usedSlots[step]) {
                                var minuteLocalCheck2 = Math.round(60/totalSlots)*slotQueue;
                                var dateLocalCheck2 = dateLocal;
                                var dateTimeLocalCheck2 = dateLocalCheck2.plus({'minute': startTimeInMins+minuteLocalCheck});
                                const diff2 = luxon.Interval.fromDateTimes(dateTimeLocalCheck2, luxon.DateTime.now());
                                const diffHours2 = diff2.length('minutes');
                                console.log("diffHours2 is " + diffHours2);
    
                                slotQueue = step++;
                                console.log("slotQueue is " + slotQueue);
                                break;
                            }
                        }
                    }
                }
                
                const minuteLocal = Math.round(60/totalSlots)*slotQueue;
                console.log("Next Available Slot Minute is " + minuteLocal);
                
                //const timeLocal = luxon.DateTime.fromISO(dateLocal,{ zone: 'America/New_York' });
                //console.log("timeLocal is " + timeLocal);

                const dateTimeLocal = dateLocal.plus({'minute': startTimeInMins+minuteLocal});
                console.log("dateTimeLocal is " + dateTimeLocal);

                const speakDateTimeLocal = dateTimeLocal.toLocaleString(luxon.DateTime.DATETIME_HUGE);
                console.log("speakDateTimeLocal is " + speakDateTimeLocal);
                
                let speakOutput = requestAttributes.t('TIME_AVAILABLE', todayOrTomorrow, speakDateTimeLocal);
                let speekReprompt = requestAttributes.t('TIME_AVAILABLE_REPROMPT', todayOrTomorrow, speakDateTimeLocal);
                
                sessionAttributes.slotToBook = dateTimeLocal;
                sessionAttributes.appointmentDate = appointmentDate;
                sessionAttributes.startTimeInMins = startTimeInMins;
                sessionAttributes.endTimeInMins = endTimeInMins;
                sessionAttributes.slotQueue = slotQueue;
                handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

                
                return responseBuilder
                    .speak(speakOutput)
                    .reprompt(speekReprompt)
                    .getResponse();
            //}
        } else if (responseData !== 'undefined' && responseData.errors !== null) {
            console.log("getAvailableSlots Error received is " + responseData.errors);
        }
       
    }).catch(console.log);

      let speakOutput = requestAttributes.t('TIME_AVAILABLE', todayOrTomorrow, startTimeInMins);
      let speekReprompt = requestAttributes.t('TIME_AVAILABLE_REPROMPT', todayOrTomorrow, startTimeInMins);
      

      /*return responseBuilder
        .speak(speakOutput)
        .reprompt(speekReprompt)
        .getResponse();
    }*/

    return responseBuilder
      .speak(speakOutput)
      .reprompt(speekReprompt)
      .getResponse();
  },
};



// This handler is used to handle 'no' utternaces
const NoIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.NoIntent';
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const speakOutput = requestAttributes.t('SCHEDULE_NO');

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .getResponse();
  },
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    const speakOutput = requestAttributes.t('HELP');
    const repromptOutput = requestAttributes.t('HELP_REPROMPT');

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt(repromptOutput)
      .getResponse();
  },
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent'
        || handlerInput.requestEnvelope.request.intent.name === 'AMAZON.StopIntent');
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    const speakOutput = requestAttributes.t('CANCEL_STOP_RESPONSE');

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .getResponse();
  },
};

// This function handles utterances that can't be matched to any
// other intent handler.
const FallbackIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.FallbackIntent';
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    const speakOutput = requestAttributes.t('FALLBACK');
    const repromptOutput = requestAttributes.t('FALLBACK_REPROMPT');

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt(repromptOutput)
      .getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    console.log(`Session ended with reason: ${handlerInput.requestEnvelope.request.reason}`);

    return handlerInput.responseBuilder.getResponse();
  },
};

// This function handles syntax or routing errors. If you receive an error
// stating the request handler chain is not found, you have not implemented
// a handler for the intent or included it in the skill builder below
const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log(`Error Request: ${JSON.stringify(handlerInput.requestEnvelope.request)}`);
    console.log(`Error handled: ${error.message}`);

    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const speakOutput = requestAttributes.t('ERROR');
    const repromptOutput = requestAttributes.t('ERROR_REPROMPT');

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt(repromptOutput)
      .getResponse();
  },
};

// This function is used for testing and debugging. It will echo back an
// intent name for an intent that does not have a suitable intent handler.
// a respond from this function indicates an intent handler function should
// be created or modified to handle the user's intent.
const IntentReflectorHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
  },
  handle(handlerInput) {
      console.log("handlerInput.requestEnvelope.requestType"+ Alexa.getRequestType(handlerInput.requestEnvelope));
      console.log("handlerInput.requestEnvelope.request.intentName" + handlerInput.requestEnvelope.request.intent.name);
    const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
    const speakOutput = `You just triggered ${intentName}`;

    return handlerInput.responseBuilder
      .speak(speakOutput)
    // .reprompt('add a reprompt if you want to keep the session open for the user to respond')
      .getResponse();
  },
};

/* INTERCEPTORS */

// This function checks to make sure required environment vairables
// exists. This function will only be called if required configuration
// is not found. So, it's just a utilty function and it is not used
// after the skill is correctly configured.
const EnvironmentCheckInterceptor = {
  process(handlerInput) {
    // load environment variable from .env
    dotenv.config();

    // check for process.env.S3_PERSISTENCE_BUCKET
    if (!process.env.S3_PERSISTENCE_BUCKET) {
      handlerInput.attributesManager.setRequestAttributes({ invalidConfig: true });
    }
  },
};

// This interceptor function checks to see if a user has enabled permissions
// to access their profile information. If not, a request attribute is set and
// and handled by the InvalidPermissionsHandler
const PermissionsCheckInterceptor = {
  async process(handlerInput) {
    const { serviceClientFactory, attributesManager } = handlerInput;

    try {
      const upsServiceClient = serviceClientFactory.getUpsServiceClient();

      const profileName = await upsServiceClient.getProfileName();
      const profileEmail = await upsServiceClient.getProfileEmail();
      const profileMobileNumber = await upsServiceClient.getProfileMobileNumber();

      if (!profileName) {
        // no profile name
        attributesManager.setRequestAttributes({ permissionsError: 'no_name' });
      }

      if (!profileEmail) {
        // no email address
        attributesManager.setRequestAttributes({ permissionsError: 'no_email' });
      }

      if (!profileMobileNumber) {
        // no mobile number
        attributesManager.setRequestAttributes({ permissionsError: 'no_phone' });
      }
    } catch (error) {
      if (error.statusCode === 403) {
        // permissions are not enabled
        attributesManager.setRequestAttributes({ permissionsError: 'permissions_required' });
      }
    }
  },
};

// This interceptor function is used for localization.
// It uses the i18n module, along with defined language
// string to return localized content. It defaults to 'en'
// if it can't find a matching language.
const LocalizationInterceptor = {
  process(handlerInput) {
    const { requestEnvelope, attributesManager } = handlerInput;

    const localizationClient = i18n.use(sprintf).init({
      lng: requestEnvelope.request.locale,
      fallbackLng: 'en-US',
      resources: languageStrings,
    });

    localizationClient.localize = (...args) => {
      // const args = arguments;
      const values = [];

      for (let i = 1; i < args.length; i += 1) {
        values.push(args[i]);
      }
      const value = i18n.t(args[0], {
        returnObjects: true,
        postProcess: 'sprintf',
        sprintf: values,
      });

      if (Array.isArray(value)) {
        return value[Math.floor(Math.random() * value.length)];
      }
      return value;
    };

    const attributes = attributesManager.getRequestAttributes();
    attributes.t = (...args) => localizationClient.localize(...args);
  },
};

/* FUNCTIONS */

// A function that gets the list of slots available for the given appointment date and clinic
function checkAvailability(centerId, appointmentDate, handlerInput) {
    return new Promise(((resolve, reject) => {

    try {
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    // params for checking availability
    const getAvailabilityRequest = {
	    operationName: "getAvailableSlots",
	    variables: {
		    centerId: centerId,
		    date: appointmentDate
	    },
	    query: "query getAvailableSlots($date: DateTime!, $centerId: String!) {\n  getAvailableSlots(date: $date, centerId: $centerId) {\n    nextSlotForToday {\n      startTimeInMins\n      endTimeInMins\n      date\n      usedSlots\n      isSlotQueueSelectionEnabled\n      totalSlots\n      offlineSlots\n      onlineSlots\n      usedOfflineSlots\n      usedOnlineSlots\n      availableSlots\n      __typename\n    }\n    otherSlotForToday {\n      startTimeInMins\n      endTimeInMins\n      date\n      usedSlots\n      isSlotQueueSelectionEnabled\n      totalSlots\n      offlineSlots\n      onlineSlots\n      usedOfflineSlots\n      usedOnlineSlots\n      availableSlots\n      __typename\n    }\n    otherSlotForTomorrow {\n      startTimeInMins\n      endTimeInMins\n      date\n      usedSlots\n      isSlotQueueSelectionEnabled\n      totalSlots\n      offlineSlots\n      onlineSlots\n      usedOfflineSlots\n      usedOnlineSlots\n      availableSlots\n      __typename\n    }\n    __typename\n  }\n}\n"
    };
    
    const data = JSON.stringify(getAvailabilityRequest);
    console.log("getAvailabilityRequest is " + data);
     
     const options = {
          hostname: process.env.DFD_APPOINTMENT_SERVICE,
          port: 443,
          path: '/graphql',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
          },
    };

    const req = https.request(options, res => {
        console.log(`statusCode: ${res.statusCode}`);
        let getAvailabilityResponse = "";
        res.on('data', d => {
            getAvailabilityResponse += d;
        });
        
        res.on('end', d => {
            resolve(getAvailabilityResponse);
            console.log('getAvailableSlots response is ' + getAvailabilityResponse);

        });
    });

    req.on('error', error => {
        console.error(error);
    });

    req.write(data);
    req.end();

    } catch (ex) {
      console.log(`bookAppointment() ERROR: ${ex.message}`);
      reject(ex);
    }
  }));
}



// This function processes a booking request by creating a .ics file,
// saving the .isc file to S3 and sending it via email to the skill ower.
function bookAppointment(handlerInput) {
  return new Promise(((resolve, reject) => {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    try {
     const appointmentData = sessionAttributes.appointmentData;
     //console.log("appointmentData is " + appointmentData);
     const data = JSON.stringify(appointmentData);
     console.log("appointmentData is " + data);
     
     const options = {
          hostname: process.env.DFD_APPOINTMENT_SERVICE,
          port: 443,
          path: '/graphql',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
          },
        };

    const req = https.request(options, res => {
    console.log(`statusCode: ${res.statusCode}`);

    res.on('data', d => {
        process.stdout.write(d);
        //const responseData = typeof d.data;
        console.log("Response d is " + d);
        const responseData = JSON.parse(d);
        console.log("Parsed Response Data is " + responseData);
        if (responseData !== 'undefined' && responseData.data !== null) {
            console.log("Data received is " + responseData.data);
            resolve(true);
        } else if (responseData !== 'undefined' && responseData.errors !== null) {
            console.log("Error received is " + responseData.errors);
            resolve(false);
        }
    });
    });

    req.on('error', error => {
        console.error(error);
    });

    req.write(data);
    req.end();

    } catch (ex) {
      console.log(`bookAppointment() ERROR: ${ex.message}`);
      reject(ex);
    }
  }));
}



/* LAMBDA SETUP */

// The SkillBuilder acts as the entry point for your skill, routing all request and response
// payloads to the handlers above. Make sure any new handlers or interceptors you've
// defined are included below. The order matters - they're processed top to bottom.
exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    InvalidConfigHandler,
    InvalidPermissionsHandler,
    LaunchRequestHandler,
    CheckAvailabilityIntentHandler,
    StartedInProgressScheduleAppointmentIntentHandler,
    CompletedScheduleAppointmentIntentHandler,
    YesIntentHandler,
    NoIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    FallbackIntentHandler,
    SessionEndedRequestHandler,
    IntentReflectorHandler,
  )
  .addRequestInterceptors(
    EnvironmentCheckInterceptor,
    PermissionsCheckInterceptor,
    LocalizationInterceptor,
  )
  .addErrorHandlers(ErrorHandler)
  .withApiClient(new Alexa.DefaultApiClient())
  .lambda();
