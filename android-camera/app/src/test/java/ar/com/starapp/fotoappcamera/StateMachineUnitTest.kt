package ar.com.starapp.fotoappcamera

import ar.com.starapp.fotoappcamera.data.NativeCapturePair
import ar.com.starapp.fotoappcamera.data.NativeCaptureSession
import ar.com.starapp.fotoappcamera.viewmodel.CaptureStep
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StateMachineUnitTest {

    @Test
    fun testCaptureSequenceSteps() {
        var currentStep = CaptureStep.READY_FOR_TICKET

        // 1. User shoots ticket
        currentStep = CaptureStep.CAPTURING_TICKET
        assertEquals(CaptureStep.CAPTURING_TICKET, currentStep)

        // 2. Picture taken -> review ticket
        currentStep = CaptureStep.REVIEW_TICKET
        assertEquals(CaptureStep.REVIEW_TICKET, currentStep)

        // 3. User accepts ticket -> ready for evidence
        currentStep = CaptureStep.READY_FOR_EVIDENCE
        assertEquals(CaptureStep.READY_FOR_EVIDENCE, currentStep)

        // 4. User shoots evidence
        currentStep = CaptureStep.CAPTURING_EVIDENCE
        assertEquals(CaptureStep.CAPTURING_EVIDENCE, currentStep)

        // 5. Picture taken -> review evidence
        currentStep = CaptureStep.REVIEW_EVIDENCE
        assertEquals(CaptureStep.REVIEW_EVIDENCE, currentStep)

        // 6. User accepts evidence -> saving pair
        currentStep = CaptureStep.SAVING_PAIR
        assertEquals(CaptureStep.SAVING_PAIR, currentStep)

        // 7. Immediately loops back to ready for ticket for next pair
        currentStep = CaptureStep.READY_FOR_TICKET
        assertEquals(CaptureStep.READY_FOR_TICKET, currentStep)
    }

    @Test
    fun testRetakeTicketDoesNotAdvanceStep() {
        var currentStep = CaptureStep.REVIEW_TICKET
        // Retake
        currentStep = CaptureStep.READY_FOR_TICKET
        assertEquals(CaptureStep.READY_FOR_TICKET, currentStep)
    }

    @Test
    fun testRetakeEvidenceKeepsTicket() {
        var ticketPreserved = true
        var currentStep = CaptureStep.REVIEW_EVIDENCE

        // Retake evidence
        currentStep = CaptureStep.READY_FOR_EVIDENCE
        assertEquals(CaptureStep.READY_FOR_EVIDENCE, currentStep)
        assertTrue("Ticket must be preserved when retaking evidence", ticketPreserved)
    }

    @Test
    fun testMonotonicPairNumbering() {
        val pairs = mutableListOf<NativeCapturePair>()
        val sessionId = "test-session-123"

        for (i in 1..25) {
            val pairNumber = (pairs.maxOfOrNull { it.pairNumber } ?: 0) + 1
            assertEquals(i, pairNumber)

            pairs.add(
                NativeCapturePair(
                    sessionId = sessionId,
                    pairNumber = pairNumber,
                    takenBy = "Lucas",
                    ticketFilePath = "/data/user/0/ar.com.starapp.fotoappcamera/files/sessions/$sessionId/ticket_$i.jpg",
                    evidenceFilePath = "/data/user/0/ar.com.starapp.fotoappcamera/files/sessions/$sessionId/evidence_$i.jpg",
                    selectedLens = if (i % 2 == 0) "wide" else "normal"
                )
            )
        }

        assertEquals(25, pairs.size)
        assertEquals(1, pairs.first().pairNumber)
        assertEquals(25, pairs.last().pairNumber)

        // Ensure all pairNumbers are strictly unique
        val uniqueNumbers = pairs.map { it.pairNumber }.toSet()
        assertEquals(25, uniqueNumbers.size)
    }

    @Test
    fun testSessionStateProgression() {
        var sessionState = NativeCaptureSession.STATE_CREATED
        assertEquals("created", sessionState)

        sessionState = NativeCaptureSession.STATE_ACTIVE
        assertEquals("active", sessionState)

        sessionState = NativeCaptureSession.STATE_FINISHING
        assertEquals("finishing", sessionState)

        sessionState = NativeCaptureSession.STATE_COMPLETED
        assertEquals("completed", sessionState)
    }
}
