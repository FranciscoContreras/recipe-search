import { Resend } from 'resend';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_RifArRK5_9Y2gxrmp3kkGRy1jznGVdFxG'; // Fallback for dev

const resend = new Resend(RESEND_API_KEY);

export async function sendApiKeyEmail(email: string, apiKey: string) {
    try {
        const { data, error } = await resend.emails.send({
            from: 'Recipe Base API <api@recipe-base.wearemachina.com>', 
            to: [email],
            subject: 'Your Recipe Base API Key',
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2>Welcome to Recipe Base API!</h2>
                    <p>Here is your personal API Key. Please keep it safe.</p>
                    
                    <div style="background: #f4f4f5; padding: 15px; border-radius: 8px; font-family: monospace; font-size: 16px; margin: 20px 0; border: 1px solid #e4e4e7;">
                        ${apiKey}
                    </div>

                    <p><strong>Important:</strong></p>
                    <ul>
                        <li>Include this key in the <code>x-api-key</code> header of your requests.</li>
                        <li>Do not share this key publicly.</li>
                        <li>If you lose this key, you will need to request a new one.</li>
                    </ul>

                    <p>Documentation: <a href="https://recipe-base.wearemachina.com/docs.html">View API Docs</a></p>
                </div>
            `
        });

        if (error) {
            console.error('Resend Error:', error);
            return false;
        }

        return true;
    } catch (e) {
        console.error('Email Send Exception:', e);
        return false;
    }
}
