import type { Gender } from "./finals";

export interface GenderGuess {
  gender: Gender;
  /** "high" = recognised first name; "low" = guessed from the spelling — should be reviewed. */
  confidence: "high" | "low";
}

const FEMALE = new Set(
  `aabha aarohi aashvi aathma aayisha abhiruchi aditi agrima akanksha aleena amale amy ananya anchal angel anjali anshika anu
   anvidha ashwika astha avani avika ayisha ayushi bhavya bhumika bishakha dakshita darshita dishita divyanka divyta drishti
   fathima gauri harshita harshada hasna hazel ishani joyshee jyoti kashvi keerthana kervi khushi khusi khwaish komal latika
   liesha mahi manasvi manya maria meher molly nandini navya nayansi neja nidhi nikita nishtha norgima ojasvi palkisha parlin
   poorvi prachi pradnya pragati prapti prashansha prashasti prisha priyanka purva radhika rajeshwari reetika riddhima rishika
   roshita ruhani samayara samriddhi sandhya saranya sejal shivi shreeya shreya shreyashi shruti shubhanjali shubhi shubhrika
   soumya sreenija sristi srushti susitha swara swati sweta tanirika tanisha tanishqa taniya tanvi unnati vaibhavi vaishnoobi
   vaishnavi vanshika vedha vedika vishakha yamini yana yashika rohini shalini samiksha manaswi siddhi tanishi sahasra radha
   rani sherin aaradhya aarushi aditri akriti alisha amrita anamika ananya anisha ankita anushka aparna archana arpita aishwarya
   avantika bhakti chhavi deepika devika disha divya diya esha garima gayatri geeta heena hetal isha ishika jahnavi kajal kavya
   khyati kirti kriti lavanya mansi meera megha mehak mitali muskan neha nisha pallavi payal pooja pratiksha pratibha rachna
   ridhi riya ruchi sakshi sanjana sanya sarika shefali shivangi shraddha simran sneha sonali srishti surbhi tanya trisha urvi
   vaishali vidhi vrinda zoya`.split(/\s+/),
);

const MALE = new Set(
  `abhinav abhiram akshat anivesh ankit arayan aryan ayush gaurav ishaan janak kavyarth lochan nalin neev piyush pranit
   raj raunak rohit rohan shivansh smit srijan sujash vidit vedant harshit deepankar chandan yash vishal suyash shasaransu
   shasransu sriram aditya akash amit anand arjun arnav ashish atharv bhavesh chirag deepak dev dhruv divyansh gautam harsh
   himanshu hitesh jay kabir karan kartik kunal lakshya madhav manav manish mayank mohit naman nikhil nitin om parth prashant
   pratik pratyush rahul rajat ravi rishabh rishi sagar sahil sameer sandeep sarthak saurabh shaurya shivam siddharth sumit
   sunny tanmay tushar uday utkarsh varun vikas vikram vinay vivek yuvraj zayd`.split(/\s+/),
);

/** Names used for any gender — a "lean" is guessed but always flagged for review. */
const UNISEX: Record<string, Gender> = {
  pranjal: "boy",
  jaskamal: "boy",
  preet: "boy",
  arya: "girl",
  gunjan: "girl",
  apurva: "girl",
  kanak: "girl",
  keerat: "girl",
  charchil: "boy",
  poursh: "boy",
  andrea: "girl",
};

const FEMALE_TITLES = new Set(["kaur", "kumari", "devi", "bai", "begum"]);
const MALE_TITLES = new Set(["singh"]);

const clean = (t: string) => t.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Guess boy/girl from a full name. Looks for a recognised first name anywhere in the name
 * (some names are written surname-first), then falls back to spelling.
 */
export function guessGender(fullName: string): GenderGuess | null {
  const tokens = fullName.split(/[\s.]+/).map(clean).filter(Boolean);
  if (!tokens.length) return null;
  // The FIRST recognised name wins, so a father's name later in the name can't override it.
  for (const t of tokens) {
    if (FEMALE.has(t)) return { gender: "girl", confidence: "high" };
    if (MALE.has(t)) return { gender: "boy", confidence: "high" };
    if (UNISEX[t]) {
      if (tokens.some((x) => FEMALE_TITLES.has(x))) return { gender: "girl", confidence: "high" };
      return { gender: UNISEX[t], confidence: "low" };
    }
  }
  if (tokens.some((x) => FEMALE_TITLES.has(x))) return { gender: "girl", confidence: "high" };
  if (tokens.some((x) => MALE_TITLES.has(x))) return { gender: "boy", confidence: "low" };
  // Spelling heuristics on the first sizeable token.
  const t = tokens.find((x) => x.length > 2);
  if (!t) return null;
  return { gender: /(a|i|ee)$/.test(t) ? "girl" : "boy", confidence: "low" };
}

export function genderLabel(g?: Gender | null): string {
  return g === "boy" ? "Boy" : g === "girl" ? "Girl" : "?";
}
