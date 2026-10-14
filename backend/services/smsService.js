const axios = require('axios');

/**
 * Send OTP via 2Factor SMS API
 * API Endpoint Format:
 * https://2factor.in/API/V1/{SMS_API_KEY}/SMS/{MOBILE_NO}/{OTP_VAL}/{TEMPLATE_NAME}
 */
const sendSmsOtp = async (mobile, otp) => {
  const apiKey = process.env.SMS_API_KEY;
  const templateName = process.env.SMS_TEMPLATE_NAME || 'OTP1';
  const cleanMobile = mobile.replace(/[^0-9]/g, '');

  if (!apiKey) {
    console.error('[SMS Service] SMS_API_KEY is not configured — cannot send OTP.');
    return {
      success: false,
      sessionId: null,
      message: 'SMS gateway not configured'
    };
  }

  console.log(`[SMS Service] Sending OTP to +91${cleanMobile.slice(0, 3)}XXXXXXX`);

  try {
    const url = `https://2factor.in/API/V1/${apiKey}/SMS/${cleanMobile}/${otp}/${templateName}`;
    const response = await axios.get(url, { timeout: 10000 });

    if (response.data && response.data.Status === 'Success') {
      console.log(`[2Factor SMS Success]: Session Details ->`, response.data);
      return {
        success: true,
        sessionId: response.data.Details,
        message: 'OTP sent successfully via SMS'
      };
    } else {
      console.warn(`[2Factor SMS Warning]: API returned non-success status ->`, response.data);
      return {
        success: false,
        sessionId: null,
        message: 'SMS gateway returned non-success status'
      };
    }
  } catch (error) {
    console.error(`[2Factor SMS Error]: ${error.message}`);
    return {
      success: false,
      sessionId: null,
      message: 'SMS gateway unavailable: ' + error.message
    };
  }
};

module.exports = {
  sendSmsOtp
};
