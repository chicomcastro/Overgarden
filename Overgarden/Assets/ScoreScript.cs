using UnityEngine;
using UnityEngine.UI;

public class ScoreScript : DataHolder
{
    public Text points;

    private void Update()
    { 
        points.text = "Score: " + DataHolder.instance.GetScore().ToString(); 
    }
}
