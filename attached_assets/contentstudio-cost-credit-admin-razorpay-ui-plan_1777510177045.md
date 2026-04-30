
# ContentStudio AI — Cost Calculation, Credit Plans, Admin Panel, Razorpay & Cinematic UI Upgrade Prompt

## 0. Important Notes

This document is built for the current ContentStudio AI architecture:

- Story Builder already exists.
- Claude Sonnet 4.6 will be used heavily for story planning, visual storyboard reasoning, JSON prompt writing, chunk-by-chunk prompt updates, and continuity summaries.
- Imagen 4 via Google Cloud Vertex AI will be used for image/reference generation.
- Video engines will remain hidden from users behind ContentStudio’s internal product names.
- Razorpay will be used for Indian payments, subscriptions, top-ups, billing, invoices, and payment webhooks.
- Admin panel must show every cost, every credit movement, every user, every job, every payment, every model usage, and platform margin.

> User-facing UI must never show raw provider names like Veo, Seedance, Freepik, Magnific, Imagen, Vertex AI, Claude, FFmpeg, API calls, or provider costs.

---

## 1. Research-Based Provider Pricing Used For Calculation

### Google Vertex AI — Video

Google Vertex AI public pricing currently lists:

| Provider Model | Mode | Price |
|---|---:|---:|
| Veo 3.1 | Video + Audio 720p / 1080p | $0.40/sec |
| Veo 3.1 | Video-only 720p / 1080p | $0.20/sec |
| Veo 3.1 Fast | Video + Audio 720p | $0.10/sec |
| Veo 3.1 Fast | Video + Audio 1080p | $0.12/sec |
| Veo 3.1 Lite | Video + Audio 720p | $0.05/sec |
| Veo 3.1 Lite | Video + Audio 1080p | $0.08/sec |
| Veo 3.1 Lite | Video-only 720p | $0.03/sec |
| Veo 3.1 Lite | Video-only 1080p | $0.05/sec |

### Google Vertex AI — Imagen 4

| Model | Price |
|---|---:|
| Imagen 4 Fast | $0.02/image |
| Imagen 4 Standard | $0.04/image |
| Imagen 4 Ultra | $0.06/image |
| Imagen 4 Upscale | $0.06/image |

For platform calculation, use **Imagen 4 Standard = $0.04/image**.

### Claude Sonnet 4.6

| Token Type | Price |
|---|---:|
| Input | $3 / 1M tokens |
| Output | $15 / 1M tokens |

For production, use prompt caching wherever possible because the same story bible, character rules, style rules, and continuity rules are reused repeatedly.

### Freepik / Magnific — Seedance 2.0 Public Credit Cost

Public pricing pages currently show:

| Provider Model | Public Credit Cost |
|---|---:|
| Seedance 2.0 720p | 1,128 credits / 4 sec |
| Seedance 2.0 Fast 720p | 960 credits / 4 sec |

For monetary estimate, this document uses the public Freepik Pro annual plan equivalent:

```text
$158.33/month for 300,000 credits/month
Estimated credit cost = $158.33 / 300,000 = $0.0005278 per Freepik credit
```

> Freepik API billing may use a different commercial rate. Before final launch, verify the exact API dashboard credit-to-money value. Keep the admin panel cost editor dynamic so you can update provider cost anytime without code changes.

### Currency Assumption

```text
1 USD ≈ ₹95
```

Use this as planning estimate only. Admin settings should store live or manually editable FX rate.

---

## 2. Claude Usage Calculation

Claude is used the most because it writes story, structure, JSON prompts, continuity summaries, and prompt corrections.

### Estimated Claude Calls for 1-Minute Video

Assumption: 8 chunks.

| Step | Input Tokens | Output Tokens |
|---|---:|---:|
| Story build / enhancement | 12k | 4k |
| Visual bible + storyboard planning | 10k | 5k |
| JSON video prompt per chunk | 64k | 20k |
| Generated chunk summary / continuity per chunk | 32k | 8k |
| **Total** | **118k** | **37k** |

Cost:

```text
Input: 118,000 × $3 / 1,000,000 = $0.354
Output: 37,000 × $15 / 1,000,000 = $0.555
Claude total = $0.909 ≈ ₹86
```

### Estimated Claude Calls for 2-Minute Video

Assumption: 15 chunks.

| Step | Input Tokens | Output Tokens |
|---|---:|---:|
| Story build / enhancement | 12k | 4k |
| Visual bible + storyboard planning | 10k | 5k |
| JSON video prompt per chunk | 120k | 37.5k |
| Generated chunk summary / continuity per chunk | 60k | 15k |
| **Total** | **202k** | **61.5k** |

Cost:

```text
Input: 202,000 × $3 / 1,000,000 = $0.606
Output: 61,500 × $15 / 1,000,000 = $0.9225
Claude total = $1.5285 ≈ ₹145
```

---

## 3. Imagen 4 Cost Calculation

Use Imagen 4 Standard for default visual reference generation.

### 1-Minute Video

Assumption: 20 generated images.

```text
20 images × $0.04 = $0.80 ≈ ₹76
```

### 2-Minute Video

Assumption: 35 generated images.

```text
35 images × $0.04 = $1.40 ≈ ₹133
```

Generated images include:

- character sheets
- location references
- opening frame
- ending frame references
- scene keyframes
- thumbnails/posters
- visual bible assets

---

## 4. Video Cost Calculation

### Freepik / Magnific — Seedance 2.0

Using estimated Freepik credit value:

```text
1 Freepik credit ≈ $0.0005278
```

#### Seedance 2.0 Fast 720p

```text
960 credits / 4 sec = 240 credits/sec
60 sec = 14,400 credits ≈ $7.60 ≈ ₹722
120 sec = 28,800 credits ≈ $15.20 ≈ ₹1,444
```

#### Seedance 2.0 720p

```text
1,128 credits / 4 sec = 282 credits/sec
60 sec = 16,920 credits ≈ $8.93 ≈ ₹848
120 sec = 33,840 credits ≈ $17.86 ≈ ₹1,697
```

### Google Vertex AI — Veo 3.1

#### Veo 3.1 Lite 720p with Audio

```text
$0.05/sec
60 sec = $3.00 ≈ ₹285
120 sec = $6.00 ≈ ₹570
```

#### Veo 3.1 Lite 1080p with Audio

```text
$0.08/sec
60 sec = $4.80 ≈ ₹456
120 sec = $9.60 ≈ ₹912
```

#### Veo 3.1 Fast 720p with Audio

```text
$0.10/sec
60 sec = $6.00 ≈ ₹570
120 sec = $12.00 ≈ ₹1,140
```

#### Veo 3.1 Standard 720p / 1080p with Audio

```text
$0.40/sec
60 sec = $24.00 ≈ ₹2,280
120 sec = $48.00 ≈ ₹4,560
```

---

## 5. Total Real Cost Estimate Per Final Video

This includes:

```text
Video generation + Claude prompt engine + Imagen 4 visual references + basic infra/export cost
```

Assumptions:

```text
1-minute infra/export/storage = $0.30
2-minute infra/export/storage = $0.60
Retry/reserve buffer = 25%
```

### 1-Minute Video Total Cost

| Internal Mode | Video Cost | Claude | Imagen 4 | Infra | Base Total | With 25% Buffer | Approx INR |
|---|---:|---:|---:|---:|---:|---:|---:|
| Cont Ultra Fast backend | $7.60 | $0.91 | $0.80 | $0.30 | $9.61 | $12.01 | ₹1,141 |
| Cont Ultra Quality backend | $8.93 | $0.91 | $0.80 | $0.30 | $10.94 | $13.67 | ₹1,299 |
| Cont Pro Lite 720p backend | $3.00 | $0.91 | $0.80 | $0.30 | $5.01 | $6.26 | ₹595 |
| Cont Pro Lite 1080p backend | $4.80 | $0.91 | $0.80 | $0.30 | $6.81 | $8.51 | ₹809 |
| Cont Pro Fast backend | $6.00 | $0.91 | $0.80 | $0.30 | $8.01 | $10.01 | ₹951 |
| Cont Pro Cinematic backend | $24.00 | $0.91 | $0.80 | $0.30 | $26.01 | $32.51 | ₹3,089 |

### 2-Minute Video Total Cost

| Internal Mode | Video Cost | Claude | Imagen 4 | Infra | Base Total | With 25% Buffer | Approx INR |
|---|---:|---:|---:|---:|---:|---:|---:|
| Cont Ultra Fast backend | $15.20 | $1.53 | $1.40 | $0.60 | $18.73 | $23.41 | ₹2,224 |
| Cont Ultra Quality backend | $17.86 | $1.53 | $1.40 | $0.60 | $21.39 | $26.74 | ₹2,540 |
| Cont Pro Lite 720p backend | $6.00 | $1.53 | $1.40 | $0.60 | $9.53 | $11.91 | ₹1,132 |
| Cont Pro Lite 1080p backend | $9.60 | $1.53 | $1.40 | $0.60 | $13.13 | $16.41 | ₹1,559 |
| Cont Pro Fast backend | $12.00 | $1.53 | $1.40 | $0.60 | $15.53 | $19.41 | ₹1,844 |
| Cont Pro Cinematic backend | $48.00 | $1.53 | $1.40 | $0.60 | $51.53 | $64.41 | ₹6,119 |

---

## 6. Recommended Internal Product Mapping

User should see simple choices. Admin should see real backend.

### User-Facing Naming

| User Sees | Quality Option | Hidden Backend |
|---|---|---|
| Cont Pro | Lite | Veo 3.1 Lite |
| Cont Pro | Fast | Veo 3.1 Fast |
| Cont Pro | Cinematic | Veo 3.1 Standard |
| Cont Ultra | Fast | Seedance 2.0 Fast |
| Cont Ultra | Quality | Seedance 2.0 |

### UI Rule

Never show backend/provider names to users. Only admin panel can show provider names and real costs.

---

## 7. Recommended ContentStudio Credit Pricing

Use **ContentStudio Credits**, not raw provider credits.

### Internal Credit Rule

```text
1 ContentStudio Credit ≈ ₹1 customer value
```

This keeps billing easy to understand.

### Feature Credit Costs

| Feature | User Credit Cost |
|---|---:|
| Story idea enhancement | 10 credits |
| Full Story Builder generation | 25 credits |
| Full cinematic story + shot list | 60 credits |
| Full JSON video prompt pack | 80 credits |
| Prompt refine / regenerate | 10 credits |
| Imagen 4 reference image | 12 credits / image |
| Thumbnail/poster generation | 15 credits |
| Voiceover script generation | 20 credits |
| Continuity check pass | 30 credits |
| Final export / packaging | 20 credits |

### Video Credit Cost Per 8-Second Part

| User-Facing Mode | Hidden Backend | Credits / 8-sec Part | 60-sec Estimate | 120-sec Estimate |
|---|---|---:|---:|---:|
| Cont Pro Lite | Veo 3.1 Lite 720p audio | 120 credits | 960 credits | 1,800 credits |
| Cont Pro Fast | Veo 3.1 Fast 720p audio | 220 credits | 1,760 credits | 3,300 credits |
| Cont Pro Cinematic | Veo 3.1 Standard audio | 650 credits | 5,200 credits | 9,750 credits |
| Cont Ultra Fast | Seedance 2.0 Fast | 250 credits | 2,000 credits | 3,750 credits |
| Cont Ultra Quality | Seedance 2.0 | 300 credits | 2,400 credits | 4,500 credits |

### Recommended Default Products

Keep the default visible choices simple:

```text
Cont Pro
- Lite
- Fast
- Cinematic

Cont Ultra
- Fast
- Quality
```

If you want an even simpler UI:

```text
Cont Pro = best for 1-minute premium quality
Cont Ultra = best for 2-minute long-form continuity
```

Quality settings can stay in “Advanced”.

---

## 8. Subscription Plans for Users

### Free Trial

```text
Price: ₹0
Credits: 100 one-time credits
Limits:
- Watermark on video
- Max 15 sec test generation
- Limited history
- No commercial license badge
```

### Starter

```text
Price: ₹799/month
Credits: 900/month
Best for: story + prompt users, light video testing
Includes:
- Story Builder
- Video Prompts
- Basic image generation
- 15s/30s lite video testing
```

### Creator

```text
Price: ₹1,999/month
Credits: 2,800/month
Best for: regular creators
Includes:
- Full Story Builder
- Video Prompts
- AI Video Studio
- 1-minute Cont Pro Lite or Cont Ultra Fast workflows
- No watermark
```

### Pro

```text
Price: ₹4,999/month
Credits: 8,000/month
Best for: creators making frequent videos
Includes:
- Priority queue
- 1-minute Cont Pro Cinematic possible
- Multiple Cont Ultra videos
- More project storage
- Full asset history
```

### Studio

```text
Price: ₹14,999/month
Credits: 28,000/month
Best for: agencies and studios
Includes:
- Team seats
- Priority processing
- Higher limits
- Admin usage reports
- Commercial export
```

### Agency

```text
Price: ₹39,999/month
Credits: 85,000/month
Best for: high-volume teams
Includes:
- Team dashboard
- Advanced analytics
- Dedicated queue
- Higher storage
- Usage controls
- Custom support
```

---

## 9. Top-Up Packs

| Pack | Price | Credits |
|---|---:|---:|
| Mini Boost | ₹299 | 300 credits |
| Creator Boost | ₹999 | 1,100 credits |
| Pro Boost | ₹2,499 | 3,000 credits |
| Studio Boost | ₹4,999 | 6,500 credits |
| Agency Boost | ₹9,999 | 14,000 credits |

Top-up credits should expire after 6 or 12 months. Subscription credits should reset monthly unless you intentionally add rollover.

---

## 10. Credit Ledger Rules

Never directly change a user’s credit balance without ledger entry.

Every credit movement must create a ledger record.

### Credit Ledger Types

```text
subscription_grant
topup_purchase
admin_adjustment
story_generation_debit
image_generation_debit
video_generation_reserved
video_generation_finalized
video_generation_refund
failed_job_refund
refund_reversal
expired_credits
```

### Reservation System

For expensive jobs:

```text
1. Estimate required credits.
2. Reserve credits before generation.
3. Run job.
4. Finalize actual credits used.
5. Refund unused reserved credits.
6. If job fails, refund reserved credits according to failure rules.
```

This prevents users from starting a 2-minute video without enough credits.

---

## 11. Razorpay Integration Requirements

Add Razorpay for:

```text
subscription plans
credit top-ups
invoices
payment history
refund handling
admin payment reconciliation
```

### Environment Variables

```env
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
```

### Payment Flow for Top-Up

```text
User selects top-up pack
↓
Server creates Razorpay Order
↓
Frontend opens Razorpay Checkout
↓
User pays
↓
Server verifies signature
↓
Webhook confirms payment.captured / order.paid
↓
Credits are added through credit_ledger
↓
Profile and dashboard balance update
```

Important:

```text
Do not add credits only from client-side success callback.
Credits should be granted only after server verification and/or webhook confirmation.
```

### Subscription Flow

```text
Admin creates Razorpay plans
↓
User selects subscription
↓
Server creates Razorpay subscription
↓
Checkout opens
↓
Razorpay webhook confirms subscription activation/payment
↓
System grants monthly credits
↓
Renewal webhooks grant next billing cycle credits
```

### Required Webhooks

```text
payment.captured
payment.failed
order.paid
subscription.activated
subscription.charged
subscription.completed
subscription.cancelled
subscription.halted
refund.processed
```

### Idempotency

Every webhook must be idempotent.

Store:

```text
razorpay_event_id
razorpay_payment_id
razorpay_order_id
razorpay_subscription_id
processed_at
```

If webhook is received again, do not grant credits twice.

---

## 12. Profile Page Requirements

Create a new **Profile** page.

### User Profile Should Show

```text
Name
Email
Avatar
Joined date
Current plan
Subscription status
Renewal date
Credit balance
Reserved credits
Used credits this month
Purchased credits
Expired credits
Project count
Video generation count
Image generation count
Prompt generation count
Invoices
Payment history
Credit usage ledger
Active devices / sessions
Delete account option
```

### Profile Tabs

```text
Overview
Credits
Subscription
Billing
Invoices
Usage
Projects
Security
Settings
```

### Profile UI Cards

```text
Current Plan Card
Credit Balance Card
Monthly Usage Card
Top-Up CTA Card
Recent Payments Card
Recent Generations Card
Subscription Renewal Card
```

---

## 13. Admin Panel Requirements

Create a full admin panel at:

```text
/admin
```

Only users with admin role can access.

### Admin Dashboard Overview

Show:

```text
Total users
Active subscriptions
MRR
ARR
Total credits sold
Total credits used
Total credits reserved
Total credits expired
Total revenue
Provider cost
Gross margin
Failed jobs
Refunds
Successful generations
Average cost per generation
Average revenue per generation
```

### Admin Sections

#### 1. Users

```text
Search users
View user profile
View credit balance
View subscription
View payments
View usage
Manually add/remove credits
Suspend user
Ban user
Export user data
```

#### 2. Credit Ledger

```text
All credit movements
Filter by user
Filter by type
Filter by date
Filter by job
Filter by payment
Manual adjustment log
Refund log
```

#### 3. Plans & Pricing

Admin can edit:

```text
plan names
prices
monthly credits
top-up packs
feature costs
video part credit cost
trial limits
credit expiry rules
discount coupons
```

#### 4. AI Jobs

```text
All generation jobs
Job status
Provider used
Hidden backend model
Duration
Chunks
Credits reserved
Credits finalized
Actual provider cost
Retry count
Failure reason
Logs
Output files
Refund issued or not
```

#### 5. Provider Cost Settings

Admin can edit backend costs without code:

```text
USD to INR exchange rate
Claude input token cost
Claude output token cost
Imagen 4 cost per image
Veo cost per second
Freepik credit value
Seedance credits per second
Storage cost
Retry buffer
Profit margin target
```

#### 6. Razorpay Payments

```text
Orders
Payments
Subscriptions
Refunds
Failed payments
Webhook logs
Duplicate webhook detection
Invoice status
```

#### 7. Analytics

```text
Revenue chart
Credit usage chart
Model usage chart
Most used features
Most expensive users
Best margin features
Failed generations by model
Average output duration
Average job time
```

#### 8. Content / Safety

```text
Flagged prompts
Blocked users
Rejected generations
Manual moderation queue
```

#### 9. Settings

```text
Site-wide credit cost
Trial limits
Maintenance mode
Provider enable/disable
Queue priority settings
Email templates
Webhook secrets status
Storage settings
```

---

## 14. Database Schema Suggestion

Add or update these tables.

```sql
users
- id
- name
- email
- avatar_url
- role
- plan_id
- razorpay_customer_id
- credit_balance
- reserved_credits
- created_at
- updated_at

plans
- id
- name
- price_inr
- billing_cycle
- monthly_credits
- max_video_duration
- priority_level
- is_active

subscriptions
- id
- user_id
- plan_id
- razorpay_subscription_id
- status
- current_period_start
- current_period_end
- renews_at
- cancelled_at

credit_ledger
- id
- user_id
- type
- amount
- balance_after
- related_job_id
- related_payment_id
- description
- created_at

topup_packs
- id
- name
- price_inr
- credits
- is_active

payments
- id
- user_id
- razorpay_order_id
- razorpay_payment_id
- razorpay_subscription_id
- amount_inr
- currency
- status
- type
- raw_payload
- created_at

webhook_events
- id
- provider
- event_id
- event_type
- payload
- processed
- processed_at
- created_at

ai_jobs
- id
- user_id
- job_type
- status
- internal_model
- hidden_provider
- duration_seconds
- chunks_total
- chunks_completed
- credits_estimated
- credits_reserved
- credits_final
- actual_provider_cost_usd
- actual_provider_cost_inr
- retry_count
- output_url
- error_message
- created_at
- completed_at

provider_cost_settings
- id
- provider
- model_key
- cost_type
- cost_value_usd
- cost_value_credits
- updated_by
- updated_at
```

---

## 15. Full Replit Prompt — Cost-Based Plans, Razorpay, Admin Panel, Profile, Cinematic UI

Use this prompt in Replit.

```md
Upgrade ContentStudio AI with a complete credit-based billing system, Razorpay payments, user profile page, admin panel, and premium cinematic UI across the full website.

IMPORTANT:
Keep all existing Story Builder, Video Prompts, AI Video Studio, Cinema Studio, Music Brief, Voiceover, Dashboard, History, and project logic intact. Do not break existing flows. Add billing, credits, admin, profile, and UI polish on top of the current system.

CORE GOAL:
ContentStudio AI should become a premium cinematic AI SaaS platform with credit-based usage. Every AI action should cost credits. Users should see clean estimated credit cost before starting an action. Admin should see real provider costs, credits, payments, jobs, users, usage, and profit margin.

DESIGN DIRECTION:
- Premium cinematic dark SaaS interface
- Black / charcoal / deep graphite background
- Neon lime-yellow primary accent
- Subtle purple glow accents
- Clean modern typography
- Strong spacing and hierarchy
- Premium cards, glass panels, soft gradients, cinematic glow, and elegant shadows
- Use SVG icons everywhere possible
- UI should feel expensive, custom-designed, and production-ready
- Avoid generic AI-template look
- Keep layout simple, clean, readable, and responsive
- Generate missing visual assets automatically in matching style
- Use cinematic visuals for hero sections, empty states, dashboard banners, feature cards, recent project thumbnails, and video studio screens

CREDIT SYSTEM:
Implement ContentStudio Credits.

1 ContentStudio Credit is the internal usage unit shown to users.

Add feature costs:
- Story idea enhancement: 10 credits
- Full Story Builder generation: 25 credits
- Full cinematic story + shot list: 60 credits
- Full JSON video prompt pack: 80 credits
- Prompt refine/regenerate: 10 credits
- Imagen/reference image generation: 12 credits per image
- Thumbnail/poster generation: 15 credits
- Voiceover script generation: 20 credits
- Continuity check pass: 30 credits
- Final export/packaging: 20 credits

Video credit costs:
- Cont Pro Lite: 120 credits per 8-sec part
- Cont Pro Fast: 220 credits per 8-sec part
- Cont Pro Cinematic: 650 credits per 8-sec part
- Cont Ultra Fast: 250 credits per 8-sec part
- Cont Ultra Quality: 300 credits per 8-sec part

Never show raw backend provider names to users. Only admin can see backend model/provider and actual provider cost.

CREDIT RESERVATION FLOW:
For expensive generation jobs:
1. Calculate estimated credits.
2. Show estimate to user.
3. Reserve credits before job starts.
4. Run generation.
5. Finalize actual credits after completion.
6. Refund unused reserved credits if any.
7. Refund reserved credits if job fails according to failure rules.

Add credit ledger table. Every credit movement must be recorded:
- subscription_grant
- topup_purchase
- admin_adjustment
- story_generation_debit
- image_generation_debit
- video_generation_reserved
- video_generation_finalized
- video_generation_refund
- failed_job_refund
- refund_reversal
- expired_credits

SUBSCRIPTION PLANS:
Create these plans:

Free Trial:
- ₹0
- 100 one-time credits
- watermark
- limited exports
- limited history

Starter:
- ₹799/month
- 900 credits/month

Creator:
- ₹1,999/month
- 2,800 credits/month

Pro:
- ₹4,999/month
- 8,000 credits/month

Studio:
- ₹14,999/month
- 28,000 credits/month

Agency:
- ₹39,999/month
- 85,000 credits/month

TOP-UP PACKS:
- ₹299 = 300 credits
- ₹999 = 1,100 credits
- ₹2,499 = 3,000 credits
- ₹4,999 = 6,500 credits
- ₹9,999 = 14,000 credits

RAZORPAY INTEGRATION:
Add Razorpay for subscriptions and top-ups.

Environment variables:
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET

Top-up flow:
1. User selects top-up pack.
2. Server creates Razorpay order.
3. Frontend opens Razorpay Checkout.
4. Server verifies payment signature.
5. Webhook confirms payment.
6. Credits are added using credit_ledger.
7. Balance updates everywhere.

Subscription flow:
1. User selects plan.
2. Server creates Razorpay subscription.
3. Checkout opens.
4. Webhook confirms subscription activation or charge.
5. System grants monthly credits using credit_ledger.
6. Renewals add monthly credits automatically.

Required webhooks:
- payment.captured
- payment.failed
- order.paid
- subscription.activated
- subscription.charged
- subscription.completed
- subscription.cancelled
- subscription.halted
- refund.processed

Important:
Never grant credits only from client-side success callback. Always use server-side verification and webhook confirmation. Make webhooks idempotent so credits are never granted twice.

PROFILE PAGE:
Create a premium /profile page.

Profile tabs:
- Overview
- Credits
- Subscription
- Billing
- Invoices
- Usage
- Projects
- Security
- Settings

Show:
- name, email, avatar
- current plan
- subscription status
- renewal date
- credit balance
- reserved credits
- used credits this month
- purchased credits
- expired credits
- project count
- video generations
- image generations
- prompt generations
- invoices
- payment history
- full credit ledger
- top-up CTA
- upgrade plan CTA

ADMIN PANEL:
Create protected /admin route. Only admin users can access.

Admin dashboard must show:
- total users
- active subscriptions
- MRR
- ARR
- total revenue
- total credits sold
- total credits used
- total credits reserved
- total credits expired
- provider cost
- gross margin
- failed jobs
- refunds
- successful generations
- average cost per generation
- average revenue per generation

Admin sections:
1. Users
- search users
- view profile
- view credits
- view subscription
- view usage
- manually add/remove credits
- suspend/ban users

2. Credit Ledger
- all credit movements
- filter by user/type/date/job/payment
- manual adjustments
- refund logs

3. Plans & Pricing
- edit plan names
- edit prices
- edit monthly credits
- edit top-up packs
- edit feature costs
- edit video part costs
- trial limits
- coupons

4. AI Jobs
- all generation jobs
- status
- hidden provider
- backend model
- duration
- chunks
- credits reserved
- credits finalized
- actual provider cost
- retry count
- failure reason
- logs
- output URLs
- refund status

5. Provider Cost Settings
Admin can update costs without code:
- USD to INR exchange rate
- Claude input cost
- Claude output cost
- Imagen 4 image cost
- Veo cost per second
- Freepik credit value
- Seedance credits per second
- storage cost
- retry buffer
- target profit margin

6. Razorpay Payments
- orders
- payments
- subscriptions
- refunds
- failed payments
- webhook logs
- duplicate webhook detection
- invoice status

7. Analytics
- revenue chart
- credit usage chart
- model usage chart
- most-used features
- most expensive users
- best-margin features
- failed generations by model
- average job time

8. Content Safety
- flagged prompts
- blocked users
- rejected generations
- moderation queue

DATABASE:
Add/extend tables:
users, plans, subscriptions, credit_ledger, topup_packs, payments, webhook_events, ai_jobs, provider_cost_settings, invoices, admin_logs.

UI ENHANCEMENT:
Enhance every page:
- Landing page
- Dashboard
- Story Builder
- Video Prompts
- AI Video Studio
- Cinema Studio
- Music Brief
- Voiceover
- History/Projects
- Pricing/Billing
- Profile
- Admin Panel
- Settings

LANDING PAGE:
Make it cinematic, premium, bold, and conversion-focused. Add strong hero, feature sections, workflow, examples, pricing, FAQs, and CTA.

DASHBOARD:
Add credit balance card, plan card, usage card, project cards, quick actions, recent generations, and cinematic hero banner.

STORY BUILDER:
Make it feel like a premium writing and filmmaking workspace. Improve inputs, genre chips, duration cards, visual style cards, voiceover settings, and assistant panel.

VIDEO PROMPTS:
Create a clean output workspace with JSON blocks, copy buttons, story summary, scene list, shot breakdown, voiceover, BGM, and export options.

AI VIDEO STUDIO:
Show generation workflow with estimated credits, reserved credits, progress timeline, chunk progression, preview, output, and final export.

CINEMA STUDIO:
Make it look like a cinematic grade/control room with style cards, visual reference panels, camera/lens controls, and polished controls.

MUSIC BRIEF:
Create mood, pacing, instrumentation, energy, and reference style cards.

VOICEOVER:
Create premium audio workspace with script blocks, voice settings, waveform preview, language selector, and microphone-themed visual assets.

HISTORY/PROJECTS:
Create searchable project cards with thumbnail, title, status, duration, credits used, style, and date.

PRICING/BILLING:
Create cinematic pricing cards, credit top-up cards, comparison table, current usage panel, and Razorpay checkout buttons.

PROFILE:
Create full user account and billing center.

ADMIN:
Create full business control center with cost, revenue, usage, users, jobs, credits, payments, and settings.

FINAL EXPECTATION:
The final site should feel like a premium cinematic AI SaaS product, not a template. It must include accurate credit usage, Razorpay payments, admin visibility, profile billing, and strong cinematic UI polish across every page.
```

---

## 16. Final Recommendation

For launch, use this product strategy:

```text
Default user mode:
Cont Ultra Fast or Cont Pro Lite

Premium user mode:
Cont Ultra Quality or Cont Pro Cinematic

Do not make Cont Pro Cinematic too cheap because real cost is high.
Use credit reservation before video generation.
Use admin cost settings so you can update provider prices anytime.
Use Razorpay webhooks for all credit grants.
Keep backend provider names hidden from users.
```

Best initial pricing:

```text
Creator plan = ₹1,999 / 2,800 credits
Pro plan = ₹4,999 / 8,000 credits
Studio plan = ₹14,999 / 28,000 credits
```

This gives you enough margin for failed generations, retries, storage, payment fees, and support.
