from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, KeepTogether
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / 'output' / 'pdf' / 'THE_LAB_App_Manual_v1_4_2026-09-30.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)

INK = colors.HexColor('#171B23')
ACCENT = colors.HexColor('#FF6B61')
PALE = colors.HexColor('#F2F4F6')
MID = colors.HexColor('#667085')
WHITE = colors.white

for name, path in [('Inter', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'), ('InterBold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')]:
    if Path(path).exists(): pdfmetrics.registerFont(TTFont(name, path))

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='LabTitle', fontName='InterBold', fontSize=35, leading=38, textColor=INK, spaceAfter=14))
styles.add(ParagraphStyle(name='LabH1', fontName='InterBold', fontSize=23, leading=27, textColor=INK, spaceAfter=12))
styles.add(ParagraphStyle(name='LabH2', fontName='InterBold', fontSize=14, leading=18, textColor=INK, spaceBefore=10, spaceAfter=6))
styles.add(ParagraphStyle(name='LabBody', fontName='Inter', fontSize=9.5, leading=14, textColor=INK, spaceAfter=7))
styles.add(ParagraphStyle(name='LabSmall', fontName='Inter', fontSize=8, leading=11, textColor=MID))
styles.add(ParagraphStyle(name='LabLabel', fontName='InterBold', fontSize=7.5, leading=10, textColor=ACCENT, spaceAfter=7))
styles.add(ParagraphStyle(name='LabWhite', fontName='Inter', fontSize=10, leading=15, textColor=WHITE))
styles.add(ParagraphStyle(name='LabWhiteTitle', fontName='InterBold', fontSize=25, leading=29, textColor=WHITE, spaceAfter=12))

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(INK); canvas.rect(0, 0, letter[0], 0.32*inch, fill=1, stroke=0)
    canvas.setFillColor(WHITE); canvas.setFont('Inter', 7)
    canvas.drawString(0.55*inch, 0.12*inch, 'THE LAB APP MANUAL  |  VERSION 1.4')
    canvas.drawRightString(letter[0]-0.55*inch, 0.12*inch, str(doc.page))
    canvas.restoreState()

def P(text, style='LabBody'): return Paragraph(text, styles[style])
def bullets(items):
    return [Table([['', P(x)]], colWidths=[0.13*inch, 6.55*inch], style=TableStyle([
        ('BACKGROUND',(0,0),(0,0),ACCENT),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(0,0),8),('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),4)
    ])) for x in items]
def page(title, label, intro):
    return [P(label.upper(),'LabLabel'), P(title,'LabH1'), P(intro), Spacer(1,5)]
def status_table(rows):
    t=Table([[P('STATUS','LabLabel'),P('WHAT IT MEANS','LabLabel')]]+[[P(a,'LabBody'),P(b,'LabBody')] for a,b in rows],colWidths=[1.55*inch,5.1*inch],repeatRows=1)
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),INK),('GRID',(0,0),(-1,-1),0.5,colors.HexColor('#D0D5DD')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('ROWBACKGROUNDS',(0,1),(-1,-1),[WHITE,PALE])]))
    return t

story=[]
story += [Spacer(1,0.55*inch), P('TRANSCENDING PERFORMANCE','LabLabel'), P('THE <font color="#FF6B61">LAB</font>','LabTitle'), Spacer(1,0.12*inch)]
hero=Table([[P('APP MANUAL','LabWhiteTitle'),P('COACHES<br/>ATHLETES<br/>ADMIN','LabWhite')]],colWidths=[4.6*inch,2.0*inch])
hero.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),INK),('BOX',(0,0),(-1,-1),1,INK),('VALIGN',(0,0),(-1,-1),'BOTTOM'),('LEFTPADDING',(0,0),(-1,-1),20),('RIGHTPADDING',(0,0),(-1,-1),20),('TOPPADDING',(0,0),(-1,-1),28),('BOTTOMPADDING',(0,0),(-1,-1),28)]))
story += [hero, Spacer(1,0.35*inch), P('A practical guide to connected athlete profiles, pre-session check-ins, Development Blocks, training, evidence, events, and staff workflow.'), Spacer(1,0.15*inch), P('<b>Version 1.4</b>  |  September 30, 2026'), P('Live app: https://the-lab-8w5d.onrender.com','LabSmall'), Spacer(1,1.25*inch), P('This handout is versioned with the app. Keep the newest copy and replace older copies after each meaningful update.','LabSmall'), PageBreak()]

story += page('Start here','01 / System map','THE LAB connects the website athlete record to the app training experience without erasing either system.')
story += [status_table([('Website','Original athlete profiles, coaching history, shared and private notes.'),('App','Development Blocks, lessons, training sessions, evidence, feedback, and events.'),('Connected workflow','Coaches assign once. THE LAB delivers to every available destination and reports the result.')]), P('The most important rule','LabH2')]
story += bullets(['Refresh the connected roster before creating a new athlete.', 'Keep both systems intact until merged records are verified.', 'Use delivery retry after an error. Do not recreate the assignment.'])
story += [P('Who can do what','LabH2'), status_table([('Athlete','Views assigned work and shared feedback; submits reflections, questions, photos, and video.'),('Coach','Views assigned athletes; creates Development Blocks; runs sessions; reviews evidence; manages events.'),('Admin','Manages staff access and membership settings in addition to coach tools.')]), PageBreak()]

story += page('Sign in and connect','02 / Access','Each person signs in with their own account. Brett and Austin connect verified staff access to the website roster.')
story += bullets(['Open the live app and choose sign in.', 'Use the same email already associated with THE LAB.', 'Staff choose the verified coaching workspace connection when prompted.', 'Athletes claim an existing app profile with the coach-provided claim code if needed.'])
story += [P('Do not create a second athlete just because the app list looks short. Open <b>Your workspace</b>, reconnect staff access if needed, and choose <b>Refresh athletes</b>.','LabBody'), P('Privacy','LabH2'), P('Private coaching notes remain restricted to authorized coaches. Shared notes, assignments, and coach feedback are visible to the athlete. Membership settings do not expose payment details to other athletes.'), PageBreak()]

story += page('Coaching Dashboard','03 / Daily workflow','Use the dashboard as the starting point for coaching work across the app and website.')
story += bullets(['Review evidence and questions that need a response.', 'Handle overdue work and items due in the next seven days.', 'Assign a clear next step.', 'Use follow-ups so ownership between Brett and Austin is visible.', 'Open Events desk for event operations.'])
story += [P('Roster health','LabH2'), status_table([('Website + app','Fully connected. The athlete can receive work in both places.'),('Website only','Website delivery works. The athlete has not claimed an app profile.'),('App only','App delivery works. No website record is linked.'),('Needs setup','Neither destination is connected; staff action is required.')]), PageBreak()]

story += page('Assign a Development Block','04 / Coach action','A Development Block connects the player problem to the lesson, practice constraint, evidence, review, and retest.')
story += bullets(['Choose <b>Assign Development</b> and select one athlete or a group.', 'Name the block and describe the player problem.', 'Choose the read target: height, time, and/or balance.', 'Set starting state, desired state, error layer, and intensity.', 'Optionally connect a learning lesson and training situation.', 'Define the constraint, expected ball, success evidence, reflection question, and due date.', 'Optionally save the pathway to the Development Library.', 'Choose <b>Assign Development Block</b>.'])
story += [P('Tip','LabH2'), P('Use the Development Library for repeatable coaching pathways, but adjust the problem and proof standard to the athlete in front of you.'), PageBreak()]

story += page('Delivery check and retry','05 / Confirmation','The assignment is saved in the app first, then sent to every available destination.')
story += [status_table([('App delivered','The athlete has a claimed app account and receives the app notification.'),('App profile not claimed','The block is saved, but the athlete must claim the app profile to use it there.'),('Website delivered','The website accepted the assignment.'),('Website needs retry','The block is safe in the app, but website delivery was not confirmed.'),('No website profile','No linked website destination exists for this athlete.')]), P('If website delivery fails','LabH2')]
story += bullets(['Open the Development Block.', 'Read the error shown in Delivery check.', 'Choose <b>Retry website delivery</b>.', 'Confirm that the status changes to Website delivered.'])
story += [P('Retries reuse the original delivery ID. This prevents a second website record if the first response was interrupted.','LabSmall'), PageBreak()]

story += page('Email notifications','06 / Communication','Shared coaching updates can reach the athlete by email as well as inside THE LAB.')
story += [status_table([('Shared coach note','Emails the athlete and links back to their profile.'),('Development Block','Emails the title, next step, and a direct link to the block.'),('Training and retest','Emails meaningful stage changes and review prompts.'),('Events and reminders','Emails registration, schedule, and reminder updates.'),('Field Notes','New-content notifications can also be emailed.'),('Private coach note','Never emailed and never shown to the athlete.')]), P('Athlete control','LabH2')]
story += bullets(['Open Profile and expand Notifications and privacy.', 'Choose <b>Important only</b> for immediate personal/action emails plus a daily routine digest.', 'Choose <b>Daily digest</b> for one email summary after 5 PM Central.', 'Choose <b>Every update</b> only if you want each alert emailed immediately, or <b>No email</b> to keep everything in the app.', 'Use each topic switch to control coach feedback, training, matches, events, reminders, courts, and Field Notes.', 'The in-app record remains available when email is off. Phone alerts remain controlled per device.'])
story += [P('Each message uses a stable idempotency key so a repeated request cannot send the same notification twice.','LabSmall'), PageBreak()]

story += page('Athlete learning loop','07 / Player experience','Every assignment moves through a visible five-part development loop.')
loop=Table([[P('1','LabH1'),P('2','LabH1'),P('3','LabH1'),P('4','LabH1'),P('5','LabH1')],[P('LEARN','LabLabel'),P('TRAIN','LabLabel'),P('EVIDENCE','LabLabel'),P('REVIEW','LabLabel'),P('RETEST','LabLabel')]],colWidths=[1.33*inch]*5)
loop.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),1,INK),('INNERGRID',(0,0),(-1,-1),0.5,colors.HexColor('#D0D5DD')),('ALIGN',(0,0),(-1,-1),'CENTER'),('TOPPADDING',(0,0),(-1,-1),13),('BOTTOMPADDING',(0,0),(-1,-1),13)]))
story += [loop, Spacer(1,14)]
story += bullets(['Open the linked lesson and assigned training.', 'Complete the work and submit a reflection plus confidence score.', 'Upload an optional photo or video as evidence.', 'Read coach feedback and the retest plan.', 'Complete the retest; the block returns to coach review.'])
story += [PageBreak()]

story += page('Pre-session check-in','08 / Prepare before arrival','Athletes answer three short questions before training. Coaches receive the exact answers in a private preparation queue and can turn them into a runnable session plan.')
story += [P('Athlete','LabH2')]
story += bullets(['From Home, choose <b>Pre-session check-in</b>.', 'Answer: What is working? What is not working? What do you want to focus on?', 'Optionally attach one photo or video.', 'Choose <b>Send to my coach</b>. The response remains visible in Recent check-ins.'])
story += [P('Coach','LabH2')]
story += bullets(['Open Coach Workspace and choose <b>Check-ins</b>.', 'Open a response to read the athlete&#39;s words and optional media.', 'Complete the preparation card: working hypothesis, starting state, likely error layer, first test, training constraint, proof of progress, and athlete note.', 'Choose <b>Save preparation</b> to keep drafting, or <b>Create session plan</b> to publish the plan and notify the athlete.', 'Choose <b>Run session plan</b> when training begins.'])
story += [P('Access rule','LabH2'), P('Only coaches assigned to that athlete can open the response. The athlete sees the check-in and plan status, while the coach preparation fields stay in the coaching workflow.'), PageBreak()]

story += page('Profiles, notes, and media','09 / Athlete record','Your workspace is the connected roster. Open an athlete to view the record and act from one place.')
story += [status_table([('Overview','Current training focuses, snapshot, and session plans.'),('Assign training','Publishes the next step to the athlete record.'),('Notes','Choose Private for coaches only or Shared with athlete.'),('Reflections','Review athlete answers and leave feedback.'),('App profile','App sessions, assignments, measurements, media, and Development Blocks.')]), P('Media and questions','LabH2'), P('Athletes can upload photos or video with evidence. Keep feedback tied to the Development Block so the question, response, and next action stay together.'), PageBreak()]

story += page('Sessions and events','10 / Live operations','Training sessions capture reps, scores, notes, and completion. Events desk handles live event operations.')
story += [P('Training session','LabH2')]
story += bullets(['Choose Start session.', 'Select athletes and a saved template or custom drills.', 'Score the work and complete the session.', 'Linked Development Blocks advance when an assigned session or retest is completed.'])
story += [P('Events desk','LabH2')]
story += bullets(['Set up registration, format, courts, schedule, and participant list.', 'Review brackets before starting the event.', 'Start, pause, resume, or stop the timer.', 'Add eligible players after the event has started.', 'Record results and publish the recap.'])
story += [PageBreak()]

story += page('Membership and troubleshooting','11 / Access support','Membership controls are present but the general paywall remains inactive until THE LAB is ready to turn billing on.')
story += [status_table([('Only one athlete appears','Open Your workspace, confirm staff access, then Refresh athletes.'),('Website roster will not load','Reconnect with Brett or Austin staff access.'),('Athlete cannot see app work','Check Roster health. Website only means the app profile still needs to be claimed.'),('Website delivery failed','Open the block and use Retry website delivery.'),('Possible duplicate','Do not delete either record. Compare identity, notes, sessions, and links first.'),('Upload failed','Keep the page open and retry; the reflection remains in the form.')]), PageBreak()]

story += page('Release notes','12 / Version control','Give staff and athletes the newest manual whenever a meaningful app update changes their workflow.')
story += [P('Version 1.4 - September 30, 2026','LabH2')]
story += bullets(['Added the Notification Control Center with Important only, Daily digest, Every update, and No email.', 'Classified alerts as urgent, important, or routine so routine content does not create immediate-email noise.', 'Added one daily digest after 5 PM Central with stable duplicate-send protection.', 'Kept topic switches, phone alerts, in-app history, and private-note protections independent.'])
story += [P('Version 1.3 - September 30, 2026','LabH2')]
story += bullets(['Added the three-question athlete pre-session check-in.', 'Added optional check-in photo or video.', 'Added a permission-scoped coach check-in queue and preparation card.', 'Added one-click conversion from a check-in to a runnable session plan.', 'Added coach and athlete notifications at the correct handoff points.'])
story += [P('Versions 1.0-1.2','LabH2'), P('Connected the website and app roster, Development Blocks, delivery receipts, membership controls, and athlete email notifications with privacy safeguards.')]
story += [Spacer(1,6), P('Update rule','LabH2'), P('Every meaningful release receives a refreshed PDF, an incremented version, and a release-note entry describing what changed and who needs to know.'), Spacer(1,6), P('Live app','LabH2'), P('https://the-lab-8w5d.onrender.com'), P('THE LAB - Transcending Performance','LabSmall')]

doc=SimpleDocTemplate(str(OUT),pagesize=letter,rightMargin=0.65*inch,leftMargin=0.65*inch,topMargin=0.62*inch,bottomMargin=0.55*inch,title='THE LAB App Manual',author='Transcending Performance')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
print(OUT)
