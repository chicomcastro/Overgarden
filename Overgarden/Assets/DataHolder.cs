using UnityEngine;

public class DataHolder : MonoBehaviour
{
    protected int score;

    public static DataHolder instance;

    [HideInInspector]
    public int numberOfPlayers;

    private void Awake()
    {
        instance = this;
    }

    private void Start()
    {
        score = 0;
        numberOfPlayers = 1;
    }

    public void AddScore(int scoreToAdd) {
        score += scoreToAdd;
    }

    public int GetScore()
    {
        return score;
    }
}
