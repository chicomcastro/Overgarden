using UnityEngine;

public class DataHolder : MonoBehaviour
{
    private int score;

    public static DataHolder instance;

    private void Awake()
    {
        instance = this;
    }

    private void Start()
    {
        score = 0;
    }

    public void AddScore(int scoreToAdd) {
        score += scoreToAdd;
    }
}
