const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const googleId = profile.id;
        const email =
          profile.emails && profile.emails[0] && profile.emails[0].value;
        const name = profile.displayName;
        const profilePic =
          profile.photos && profile.photos[0] && profile.photos[0].value;

        let user = await User.findOne({ googleId });

        if (!user) {
          // Also check by email in case the user exists without googleId
          user = await User.findOne({ email });
          if (user) {
            user.googleId = googleId;
            if (!user.profilePic && profilePic) user.profilePic = profilePic;
            if (!user.name && name) user.name = name;
            await user.save();
          } else {
            user = await User.create({
              googleId,
              email,
              name,
              profilePic,
            });
          }
        }

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

module.exports = passport;
