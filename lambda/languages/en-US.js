module.exports = {
  translation: {
    SKILL_NAME: 'WellStreet Urgent Care',
    GREETING: [
      'Hello. Welcome to %s. Would you like to schedule an appointment?',
      'Hi. Welcome to %s. Would you like to schedule an appointment?',
      'Hey there. Welcome to %s. Would you like to schedule an appointment?',
    ],
    GREETING_REPROMPT: [
      'Would you like to schedule an appointment?',
      'Can I schedule an appointment for you?',
      'I can schedule an appointment for you. Would you like to get started?',
    ],
    SCHEDULE_YES: [
      'Okay, let\'s schedule an appointment.',
      'Okay, let\'s get started.',
      'Alright, let\'s get you scheduled.',
    ],
    SCHEDULE_YES_CONFIRMATION: [
      'Okay, I need few more details to schedule your appointment.',
      'Alright, I just need few more details to get you scheduled.',
    ],
    SCHEDULE_NO: [
      'All right. Stop back whenever you\'d like to schedule an appointment.',
      'Okay, I\'ll be here whenever you want to schedule an appointment.',
      'Alright, when you\'re ready to schedule an appointment, please stop back.',
    ],
    HELP: [
      'This skill can help you schedule an appointment. Would you like to schedule an appointment?',
    ],
    HELP_REPROMPT: [
      'Would you like to schedule an appointment?',
    ],
    CANCEL_STOP_RESPONSE: [
      'Good bye',
      'Okay. I\'ll be here if you need me.',
    ],
    FALLBACK: [
      'You can say: you would like to schedule an appointment or that you have an appointment request to make. Would you like to schedule an appointment?',
    ],
    FALLBACK_REPROMPT: [
      'Would you like to schedule an appointment?',
    ],
    APPOINTMENT_CONFIRM: [
      'I have your appointment request set for %s on %s at %s. Would you like to confirm this request?',
    ],
    APPOINTMENT_CONFIRM_REPROMPT: [
      'Should I send your appointment request for %s?',
    ],
    APPOINTMENT_CONFIRM_COMPLETED: [
      'Your appointment for %s at %s has been confirmed. You\'ll also recieve an SMS confirmation. Please complete your registration using the link in the SMS message before your appointment time. Thank you.',
    ],
    TIME_AVAILABLE: [
      'The next appointment available for %s is at %s. Would you like to book it?',
    ],
    TIME_AVAILABLE_REPROMPT: [
      'Would you like to book for %s at %s?',
    ],
    TIME_NOT_AVAILABLE: [
      'Sorry, %s is not available. Would you like to try another time?',
    ],
    TIME_NOT_AVAILABLE_REPROMPT: [
      'Would you like to try another time?',
    ],
    NO_SLOT_AVAILABLE: [
      'There is no slot available for %s . Would you like to try for %s?',
    ],
    APPOINTMENT_TITLE: 'Appointment with %s',
    APPOINTMENT_DESCRIPTION: 'This is a telephone appointment for %s with %s. We will call you at %s. If you need to cancel or change this appointment, please reply to this email.',
    EMAIL_SUBJECT: 'Appointment for %s with %s',
    EMAIL_TEXT: 'This is a telephone appointment for %s with %s. We will call you at %s. If you need to cancel or change this appointment, please reply to this email.',
    NO_CONFIRM: 'Okay, to start over you can say: schedule an appointment, or to cancel say stop.',
    NO_CONFIRM_REPROMOT: 'You can say schedule an appointment to start over, or stop to cancel.',
    ENV_NOT_CONFIGURED: 'One or more environment variables is not set. Please see the readme file for help.',
    PERMISSIONS_REQUIRED: 'In order to book and confirm appointments, %s will need access to your name, email address, and phone number. To provide access, please enable profile permissions in the Amazon Alexa app.',
    EMAIL_REQUIRED: 'It looks like you don\'t have an email set. You can set your email in the Alexa companion app.',
    EMAIL_REQUIRED_REPROMPT: 'Please set your email address in the Alexa companion app.',
    NAME_REQUIRED: 'It looks like you don\'t have your name set. You can set your name in the Alexa companion app.',
    NAME_REQUIRED_REPROMPT: 'Please set your name in the Alexa companion app.',
    PHONE_REQUIRED: 'It looks like you don\'t have your mobile number set. You can set your mobile number in the companion app.',
    PHONE_REQUIRED_REPROMPT: 'Please set your phone number in the Alexa companion app.',
    ERROR: 'Sorry, I didn\'t get that. Could you say that again?',
    ERROR_REPROMPT: 'Could you say that again?',
    FREEBUSY_DISABLED: 'Sorry, freebusy checking is disabled. Would you like to schedule an appointment anyway?',
  },
};
