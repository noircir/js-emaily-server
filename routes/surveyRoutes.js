// These three libraries are for parsing SendGrid click results.
const _ = require('lodash');
const { Path } = require('path-parser');
// 'url' library comes with Node.js
const { URL } = require('url');
const mongoose = require('mongoose');
const requireLogin = require('../middlewares/requireLogin');
const requireCredits = require('../middlewares/requireCredits');
const Mailer = require('../services/Mailer');
const surveyTemplate = require('../services/emailTemplates/surveyTemplate');

// We could require Survey model from the model file,
// but sometimes mongoose complains during testing ('too many requests').
const Survey = mongoose.model('surveys');

module.exports = (app) => {
	app.get('/api/surveys', requireLogin, async (req, res) => {
		const surveys = await Survey.find({ _user: req.user.id }).select({ recipients: false });

		res.send(surveys);
	});

	app.get('/api/surveys/:surveyId/:choice', (req, res) => {
		res.send('Thanks for voting!');
	});

	app.post('/api/surveys/webhooks', (req, res) => {
		const p = new Path('/api/surveys/:surveyId/:choice');
		// Extract email, surveyId, and answer first.

		// const events = _.map(req.body, ({ url, email }) => {
		// 	// p.test(pathname) returns an object with wildcards :surveyId
		// 	// and :choice, or null
		// 	const match = p.test(new URL(url).pathname);
		// 	console.log('=======================');
		// 	console.log('match: ', match);
		// 	console.log('=======================');
		// 	if (match) {
		// 		return { email, surveyId: match.surveyId, choice: match.choice };
		// 	}
		// });

		// console.log('=======================');
		// console.log('events: ', events);
		// console.log('=======================');

		// // Second, remove any "undefined" results.
		// const compactEvents = _.compact(events);

		// // Remove duplicates where both email and surveyID are similar.
		// const uniiqueEvents = _.uniqBy(compactEvents, 'email', 'surveyId');

		_.chain(req.body)
			.map(({ url, email }) => {
				const match = p.test(new URL(url).pathname);
				if (match) {
					return { email, surveyId: match.surveyId, choice: match.choice };
				}
			})
			.compact()
			.uniqBy('email', 'surveyId')
			.each(({ surveyId, email, choice }) => {
				Survey.updateOne(
					{
						_id: surveyId,
						recipients: {
							$elemMatch: { email: email, responded: false }
						}
					},
					{
						$inc: { [choice]: 1 },
						$set: { 'recipients.$.responded': true },
						lastResponded: new Date()
					}
				).exec();
			})
			.value();

		// console.log(events);
		res.send({});
	});

	app.post('/api/surveys', requireLogin, requireCredits, async (req, res) => {
		const { title, subject, body, recipients } = req.body;

		const survey = new Survey({
			title,
			subject,
			body,
			recipients: recipients.split(',').map((email) => ({ email: email.trim() })),
			// id generated by Mongo (mongoose)
			_user: req.user.id,
			dateSent: Date.now()
		});

		try {
			// Send an email here
			const mailer = new Mailer(survey, surveyTemplate(survey));
			await mailer.send();
			await survey.save();
			req.user.credits -= 1;
			const user = await req.user.save();

			res.send(user);
		} catch (err) {
			res.status(422).send(err);
		}
	});
};
